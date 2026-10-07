#!/usr/bin/env python3
"""Tests for build/update_all.py publish() against a local bare "GitHub".

The bare remote carries a pre-receive hook that imitates GitHub:
  * "secrets": rejects any pushed commit whose data/library.json contains
    FAKE_TOKEN, with GitHub's real GH013 push-protection wording (the 2026-09
    false positive on TorahAnytime stream URLs);
  * "rule":    rejects every push with a GH013 that is NOT push protection;
  * "down":    rejects every push with a plain error (e.g. the locked keychain).
Every hook invocation is counted, so "pushes once, no loop" is checked directly.

  python3 tests/test_update_all_publish.py
"""
import contextlib
import importlib.util
import io
import os
import subprocess
import tempfile
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location(
    "update_all", os.path.join(ROOT, "build", "update_all.py"))
update_all = importlib.util.module_from_spec(spec)
spec.loader.exec_module(update_all)

AUTO = update_all.AUTO_MSG
FAKE_TOKEN = "flagged-by-fake-push-protection"  # stands in for the flagged URL fragment

# GitHub's wording (from launchd.err.log, 2026-09), em dashes included: the
# decoder must survive non-ASCII under launchd.
GH013_SECRETS = """error: GH013: Repository rule violations found for refs/heads/main.

- GITHUB PUSH PROTECTION
  ——————————
    Resolve the following violations before pushing again

    - Push cannot contain secrets

      —— VolcEngine Access Key ID ——————
       locations:
         - commit: $c
           path: data/library.json:1
"""
GH013_RULE = """error: GH013: Repository rule violations found for refs/heads/main.

- Changes must be made through a pull request.
"""

HOOK_HEAD = """#!/bin/sh
echo attempt >> '{attempts}'
"""
HOOKS = {
    "secrets": HOOK_HEAD + """zero=0000000000000000000000000000000000000000
while read old new ref; do
  if [ "$old" = "$zero" ]; then range="$new"; else range="$old..$new"; fi
  for c in $(git rev-list $range); do
    if git show "$c:data/library.json" 2>/dev/null | grep -q '{token}'; then
      cat >&2 <<EOF
{gh013}EOF
      exit 1
    fi
  done
done
exit 0
""",
    "rule": HOOK_HEAD + """cat >&2 <<'EOF'
{rule}EOF
exit 1
""",
    "down": HOOK_HEAD + """echo "fatal: could not read Username: Device not configured" >&2
exit 1
""",
}


def git(*args, cwd=None, check=True):
    p = subprocess.run(["git"] + list(args), cwd=cwd, capture_output=True,
                       encoding="utf-8", errors="replace")
    if check and p.returncode != 0:
        raise AssertionError(f"git {' '.join(args)} failed: {p.stderr}")
    return p.stdout.strip()


class PublishTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(prefix="publish-test-")
        self.tmp = os.path.realpath(self._tmp.name)
        empty_cfg = os.path.join(self.tmp, "empty.gitconfig")
        open(empty_cfg, "w").close()
        env = mock.patch.dict(os.environ, {
            "GIT_CONFIG_GLOBAL": empty_cfg, "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.invalid",
            "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.invalid",
            "GIT_TERMINAL_PROMPT": "0"})
        env.start()
        self.addCleanup(env.stop)
        self.addCleanup(self._tmp.cleanup)

        self.remote = os.path.join(self.tmp, "remote.git")
        self.seed = os.path.join(self.tmp, "seed")
        self.work = os.path.join(self.tmp, "work")
        self.attempts = os.path.join(self.tmp, "attempts.log")
        git("init", "-q", "--bare", self.remote)
        git("symbolic-ref", "HEAD", "refs/heads/main", cwd=self.remote)
        git("init", "-q", self.seed)
        git("checkout", "-q", "-b", "main", cwd=self.seed)
        for rel, body in (("data/library.json", '{"lectures": ["v0"]}\n'),
                          ("data/orig_audio.json", "{}\n"),
                          ("media/manifest.json", "{}\n"),
                          ("README.md", "readme\n"),
                          ("app.js", "// app\n")):
            self.write(rel, body, base=self.seed)
        git("add", "-A", cwd=self.seed)
        git("commit", "-q", "-m", "initial", cwd=self.seed)
        git("remote", "add", "origin", self.remote, cwd=self.seed)
        git("push", "-q", "origin", "main", cwd=self.seed)
        git("clone", "-q", self.remote, self.work)
        self.base = git("rev-parse", "HEAD", cwd=self.work)

        patches = [mock.patch.object(update_all, "HERE", self.work),
                   mock.patch.object(update_all, "LOG", os.path.join(self.tmp, "update_all.log"))]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    # helpers ---------------------------------------------------------------
    def write(self, rel, body, base=None):
        path = os.path.join(base or self.work, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(body)

    def hook(self, kind):
        path = os.path.join(self.remote, "hooks", "pre-receive")
        if kind is None:
            if os.path.exists(path):
                os.rename(path, path + ".off")
            return
        body = HOOKS[kind].format(attempts=self.attempts, token=FAKE_TOKEN,
                                  gh013=GH013_SECRETS, rule=GH013_RULE)
        with open(path, "w") as f:
            f.write(body)
        os.chmod(path, 0o755)

    def push_attempts(self):
        try:
            with open(self.attempts) as f:
                return len(f.read().split())
        except FileNotFoundError:
            return 0

    def strand(self, body, msg=AUTO):
        """A local commit that never reached the remote (an earlier failed run)."""
        self.write("data/library.json", body)
        git("add", "data/library.json", cwd=self.work)
        git("commit", "-q", "-m", msg, cwd=self.work)

    def remote_subjects(self):
        return git("log", "--format=%s", "main", cwd=self.remote).splitlines()

    def remote_file(self, rel):
        return git("show", f"main:{rel}", cwd=self.remote)

    def remote_ever_had_token(self):
        for c in git("rev-list", "main", cwd=self.remote).split():
            if FAKE_TOKEN in git("show", f"{c}:data/library.json", cwd=self.remote, check=False):
                return True
        return False

    def local_unpushed(self):
        return git("log", "--format=%s", "origin/main..HEAD", cwd=self.work).splitlines()

    def publish(self):
        out, err = io.StringIO(), io.StringIO()
        before = os.path.getsize(update_all.LOG) if os.path.exists(update_all.LOG) else 0
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = update_all.publish()
        with open(update_all.LOG, encoding="utf-8") as f:
            f.seek(before)
            self.last_log = f.read()
        self.last_stderr = err.getvalue()
        return rc

    # the ordinary paths ------------------------------------------------------
    def test_new_data_is_committed_and_pushed(self):
        self.hook("secrets")
        self.write("data/library.json", '{"lectures": ["v1"]}\n')
        self.assertEqual(self.publish(), 0)
        self.assertIn("pushed data refresh", self.last_log)
        self.assertEqual(self.remote_subjects(), [AUTO, "initial"])
        self.assertEqual(self.remote_file("data/library.json"), '{"lectures": ["v1"]}')
        self.assertEqual(self.push_attempts(), 1)

    def test_no_changes_does_nothing(self):
        self.hook("secrets")
        self.assertEqual(self.publish(), 0)
        self.assertIn("no data changes", self.last_log)
        self.assertEqual(self.push_attempts(), 0)

    def test_stranded_commit_is_retried_without_new_data(self):
        self.hook("down")
        self.write("data/library.json", '{"lectures": ["v1"]}\n')
        self.assertEqual(self.publish(), 1)
        self.assertIn("push failed — will retry next run", self.last_log)
        self.assertIn("Device not configured", self.last_stderr)  # receipt passed through
        self.assertEqual(self.local_unpushed(), [AUTO])
        self.hook(None)
        self.assertEqual(self.publish(), 0)
        self.assertIn("retrying the push", self.last_log)
        self.assertEqual(self.remote_subjects(), [AUTO, "initial"])

    def test_remote_code_commit_is_rebased_in(self):
        self.write("app.js", "// app v2\n", base=self.seed)
        git("commit", "-q", "-am", "code change", cwd=self.seed)
        git("push", "-q", "origin", "main", cwd=self.seed)
        self.write("data/library.json", '{"lectures": ["v1"]}\n')
        self.assertEqual(self.publish(), 0)
        self.assertEqual(self.remote_subjects(), [AUTO, "code change", "initial"])
        self.assertEqual(git("rev-parse", "HEAD", cwd=self.work),
                         git("rev-parse", "main", cwd=self.remote))

    def test_only_data_files_go_into_the_auto_commit(self):
        self.write("README.md", "hand edit, staged but not committed\n")
        git("add", "README.md", cwd=self.work)
        self.write("data/library.json", '{"lectures": ["v1"]}\n')
        self.assertEqual(self.publish(), 0)
        changed = git("show", "--name-only", "--format=", "main", cwd=self.remote).split()
        self.assertEqual(changed, ["data/library.json"])
        # The hand edit stays in the checkout (autostash hands it back unstaged).
        self.assertIn("README.md", git("status", "--porcelain", cwd=self.work))
        with open(os.path.join(self.work, "README.md")) as f:
            self.assertIn("hand edit", f.read())

    # push protection ---------------------------------------------------------
    def test_push_protection_squashes_stranded_auto_commits_and_recovers(self):
        self.hook("secrets")
        self.strand('{"lectures": ["v1 %s"]}\n' % FAKE_TOKEN)   # the flagged commit
        self.strand('{"lectures": ["v2 %s"]}\n' % FAKE_TOKEN)   # more stranded refreshes
        self.write("data/library.json", '{"lectures": ["v3 rotated"]}\n')  # URLs rotated
        self.assertEqual(self.publish(), 0)
        self.assertIn("push protection rejected the push", self.last_log)
        self.assertIn("Squashing 3 unpushed auto commit(s)", self.last_log)
        self.assertIn("pushed data refresh after squashing", self.last_log)
        self.assertIn("Push cannot contain secrets", self.last_stderr)
        self.assertEqual(self.push_attempts(), 2)               # rejected, then once more
        self.assertEqual(self.remote_subjects(), [AUTO, "initial"])  # ONE fresh commit
        self.assertEqual(self.remote_file("data/library.json"), '{"lectures": ["v3 rotated"]}')
        self.assertEqual(git("rev-parse", "main~1", cwd=self.remote), self.base)
        self.assertFalse(self.remote_ever_had_token())
        self.assertEqual(self.local_unpushed(), [])
        self.assertEqual(git("status", "--porcelain", cwd=self.work), "")

    def test_push_protection_recurring_stops_then_next_run_recovers(self):
        self.hook("secrets")
        self.strand('{"lectures": ["v1 %s"]}\n' % FAKE_TOKEN)
        self.write("data/library.json", '{"lectures": ["v2 %s"]}\n' % FAKE_TOKEN)  # still flagged
        self.assertEqual(self.publish(), 1)
        self.assertIn("rejected the fresh commit too", self.last_log)
        self.assertIn("Stopping (no loop)", self.last_log)
        self.assertEqual(self.push_attempts(), 2)               # no loop
        self.assertEqual(self.remote_subjects(), ["initial"])
        self.assertEqual(self.local_unpushed(), [AUTO])         # squashed, kept locally
        with open(os.path.join(self.work, "data/library.json")) as f:
            self.assertIn("v2", f.read())                       # working data untouched

        # The next hourly run, after TorahAnytime rotated the URLs.
        self.write("data/library.json", '{"lectures": ["v3 rotated"]}\n')
        self.assertEqual(self.publish(), 0)
        self.assertEqual(self.push_attempts(), 4)
        self.assertEqual(self.remote_subjects(), [AUTO, "initial"])
        self.assertEqual(self.remote_file("data/library.json"), '{"lectures": ["v3 rotated"]}')
        self.assertFalse(self.remote_ever_had_token())

    def test_squash_with_nothing_left_to_publish(self):
        self.hook("secrets")
        self.strand('{"lectures": ["v1 %s"]}\n' % FAKE_TOKEN)
        self.write("data/library.json", '{"lectures": ["v0"]}\n')   # back to what GitHub has
        self.strand('{"lectures": ["v0"]}\n')
        self.assertEqual(self.publish(), 0)
        self.assertIn("nothing to publish", self.last_log)
        self.assertEqual(self.push_attempts(), 1)
        self.assertEqual(self.remote_subjects(), ["initial"])
        self.assertEqual(git("rev-parse", "HEAD", cwd=self.work), self.base)

    def test_other_rule_violation_is_not_squashed(self):
        self.hook("rule")
        self.strand('{"lectures": ["v1"]}\n')
        stranded = git("rev-parse", "HEAD", cwd=self.work)
        self.write("data/library.json", '{"lectures": ["v2"]}\n')
        self.assertEqual(self.publish(), 1)
        self.assertIn("push failed — will retry next run", self.last_log)
        self.assertNotIn("Squashing", self.last_log)
        self.assertEqual(self.push_attempts(), 1)
        self.assertEqual(git("rev-parse", "HEAD~1", cwd=self.work), stranded)  # history kept
        self.assertEqual(self.local_unpushed(), [AUTO, AUTO])

    # commits that are not the job's ----------------------------------------
    def test_unpushed_non_data_commit_blocks_the_push(self):
        self.write("app.js", "// remote moved on\n", base=self.seed)
        git("commit", "-q", "-am", "code change", cwd=self.seed)
        git("push", "-q", "origin", "main", cwd=self.seed)
        self.hook("secrets")
        self.write("README.md", "hand edit\n")
        git("commit", "-q", "-am", "hand edit in the live checkout", cwd=self.work)
        hand = git("rev-parse", "HEAD", cwd=self.work)
        self.write("data/library.json", '{"lectures": ["v1 %s"]}\n' % FAKE_TOKEN)
        self.assertEqual(self.publish(), 1)
        self.assertIn("unpushed non-data commits; not pushing", self.last_log)
        self.assertEqual(self.push_attempts(), 0)
        self.assertEqual(self.remote_subjects(), ["code change", "initial"])
        # Left exactly as they were: not rebased, not squashed.
        self.assertEqual(git("rev-parse", "HEAD~1", cwd=self.work), hand)
        self.assertEqual(git("rev-parse", "HEAD~2", cwd=self.work), self.base)
        # The next run says the same and still leaves them.
        self.assertEqual(self.publish(), 1)
        self.assertIn("unpushed non-data commits; not pushing", self.last_log)
        self.assertEqual(git("rev-parse", "HEAD~1", cwd=self.work), hand)

    def test_failed_rebase_is_aborted_not_left_in_progress(self):
        self.write("data/library.json", '{"lectures": ["remote"]}\n', base=self.seed)
        git("commit", "-q", "-am", AUTO, cwd=self.seed)
        git("push", "-q", "origin", "main", cwd=self.seed)
        self.write("data/library.json", '{"lectures": ["local"]}\n')
        self.assertEqual(self.publish(), 1)
        self.assertIn("pull --rebase failed — not pushing", self.last_log)
        gitdir = os.path.join(self.work, ".git")
        self.assertFalse(os.path.exists(os.path.join(gitdir, "rebase-merge")))
        self.assertFalse(os.path.exists(os.path.join(gitdir, "rebase-apply")))
        self.assertEqual(git("symbolic-ref", "--short", "HEAD", cwd=self.work), "main")
        self.assertEqual(self.local_unpushed(), [AUTO])


class PushProtectionDetectionTest(unittest.TestCase):
    def test_detects_github_push_protection(self):
        self.assertTrue(update_all.push_protection_hit(
            "remote: " + GH013_SECRETS.replace("\n", "\nremote: ")
            + " ! [remote rejected] main -> main (push declined due to repository rule violations)"))
        self.assertTrue(update_all.push_protection_hit(
            "remote: error: GH009: Secrets detected! This push failed."))

    def test_ignores_other_failures(self):
        for text in (GH013_RULE,
                     "fatal: could not read Username for 'https://github.com': Device not configured",
                     " ! [rejected] main -> main (fetch first)",
                     "", None):
            self.assertFalse(update_all.push_protection_hit(text), text)


if __name__ == "__main__":
    unittest.main()
