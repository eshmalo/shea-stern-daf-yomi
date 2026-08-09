#!/usr/bin/env python3
"""Unit tests for the admin API. Run: python3 admin-api/test_lambda_function.py -v
No AWS/network needed — the S3 client is faked in-memory."""
import hashlib
import json
import os
import time
import unittest
from unittest import mock

os.environ.update({
    "S3_ENDPOINT_URL": "https://example.invalid",
    "S3_BUCKET": "test-bucket",
    "R2_ACCESS_KEY_ID": "k",
    "R2_SECRET_ACCESS_KEY": "s",
    "CDN_BASE_URL": "https://cdn.example.invalid",
    "ADMIN_PW_HASH": "pbkdf2$1000$aabb$" + hashlib.pbkdf2_hmac(
        "sha256", b"correct-horse", bytes.fromhex("aabb"), 1000).hex(),
    "SESSION_SECRET": "unit-test-secret",
    "ALLOWED_ORIGINS": "https://monseydafyomi.com,http://localhost:8788",
})

import lambda_function as lf


class NoSuchKey(Exception):
    pass


class FakeS3:
    """In-memory stand-in for the boto3 S3 client surface the API uses."""
    class exceptions:
        NoSuchKey = NoSuchKey

    def __init__(self):
        self.objects = {}
        self.mpu = {}

    def get_object(self, Bucket, Key):
        if Key not in self.objects:
            raise NoSuchKey(Key)
        import io
        return {"Body": io.BytesIO(self.objects[Key])}

    def put_object(self, Bucket, Key, Body, **kw):
        self.objects[Key] = Body if isinstance(Body, bytes) else Body.encode()

    def head_object(self, Bucket, Key):
        if Key not in self.objects:
            raise NoSuchKey(Key)
        return {}

    def copy_object(self, Bucket, Key, CopySource):
        self.objects[Key] = self.objects.get(CopySource["Key"], b"")

    def delete_object(self, Bucket, Key):
        self.objects.pop(Key, None)

    def generate_presigned_url(self, op, Params, ExpiresIn):
        return f"https://signed.example.invalid/{op}/{Params['Key']}"

    def create_multipart_upload(self, Bucket, Key, **kw):
        self.mpu[Key] = "upload-1"
        return {"UploadId": "upload-1"}

    def complete_multipart_upload(self, Bucket, Key, UploadId, MultipartUpload):
        assert self.mpu.get(Key) == UploadId, "unknown upload"
        self.objects[Key] = b"assembled"

    def abort_multipart_upload(self, Bucket, Key, UploadId):
        self.mpu.pop(Key, None)


def call(method, path, body=None, token=None, origin="https://monseydafyomi.com"):
    headers = {"origin": origin}
    if token:
        headers["authorization"] = "Bearer " + token
    event = {
        "requestContext": {"http": {"method": method, "sourceIp": "1.2.3.4"}},
        "rawPath": path,
        "headers": headers,
        "body": json.dumps(body) if body is not None else "",
    }
    r = lf.lambda_handler(event, None)
    return r["statusCode"], json.loads(r["body"]) if r["body"] else {}, r["headers"]


def login():
    code, out, _ = call("POST", "/login", {"password": "correct-horse"})
    assert code == 200, out
    return out["token"]


class Base(unittest.TestCase):
    def setUp(self):
        lf._s3 = FakeS3()
        lf._fails.update(n=0, at=0.0, ip={})
        self.sleep_patch = mock.patch("time.sleep")
        self.sleep_patch.start()

    def tearDown(self):
        self.sleep_patch.stop()


class TestAuth(Base):
    def test_wrong_password(self):
        code, out, _ = call("POST", "/login", {"password": "nope"})
        self.assertEqual(code, 401)

    def test_right_password_and_token_works(self):
        token = login()
        code, out, _ = call("GET", "/state", token=token)
        self.assertEqual(code, 200)
        self.assertIn("data", out)

    def test_no_token(self):
        code, _, _ = call("GET", "/state")
        self.assertEqual(code, 401)

    def test_tampered_token(self):
        token = login()
        bad = token[:-4] + ("0000" if token[-4:] != "0000" else "1111")
        code, _, _ = call("GET", "/state", token=bad)
        self.assertEqual(code, 401)

    def test_expired_token(self):
        with mock.patch("time.time", return_value=time.time() - lf.TOKEN_TTL - 60):
            token, _ = lf.make_token()
        code, _, _ = call("GET", "/state", token=token)
        self.assertEqual(code, 401)

    def test_lockout_after_25_failures(self):
        for _ in range(25):
            call("POST", "/login", {"password": "nope"})
        code, _, _ = call("POST", "/login", {"password": "correct-horse"})
        self.assertEqual(code, 429)

    def test_non_string_password(self):
        code, _, _ = call("POST", "/login", {"password": {"$gt": ""}})
        self.assertEqual(code, 401)


class TestCors(Base):
    def test_allowed_origin_echoed(self):
        _, _, h = call("POST", "/login", {"password": "nope"})
        self.assertEqual(h.get("Access-Control-Allow-Origin"), "https://monseydafyomi.com")

    def test_disallowed_origin_gets_no_acao(self):
        _, _, h = call("POST", "/login", {"password": "nope"}, origin="https://evil.example")
        self.assertNotIn("Access-Control-Allow-Origin", h)

    def test_preflight(self):
        code, _, h = call("OPTIONS", "/presign")
        self.assertEqual(code, 204)
        self.assertIn("authorization", h.get("Access-Control-Allow-Headers", ""))


class TestPresign(Base):
    def test_single_put(self):
        token = login()
        code, out, _ = call("POST", "/presign", {
            "kind": "worksheet", "pageKey": "daf:Chullin:100",
            "filename": "sources.pdf", "contentType": "application/pdf",
            "size": 1024}, token=token)
        self.assertEqual(code, 200)
        self.assertEqual(out["mode"], "single")
        self.assertRegex(out["key"], r"^site/uploads/worksheet/daf-chullin-100/\d+-[a-f0-9]{8}\.pdf$")

    def test_multipart_for_big_video(self):
        token = login()
        code, out, _ = call("POST", "/presign", {
            "kind": "video", "pageKey": "daf:Chullin:100",
            "filename": "shiur.mp4", "contentType": "video/mp4",
            "size": 500 * 1024 * 1024}, token=token)
        self.assertEqual(code, 200)
        self.assertEqual(out["mode"], "multipart")
        self.assertTrue(out["uploadId"])

    def test_bad_content_type_rejected(self):
        token = login()
        code, out, _ = call("POST", "/presign", {
            "kind": "worksheet", "pageKey": "daf:Chullin:100",
            "filename": "x.html", "contentType": "text/html", "size": 10}, token=token)
        self.assertEqual(code, 400)

    def test_oversize_rejected(self):
        token = login()
        code, _, _ = call("POST", "/presign", {
            "kind": "worksheet", "pageKey": "daf:Chullin:100",
            "filename": "x.pdf", "contentType": "application/pdf",
            "size": lf.SIZE_CAPS["worksheet"] + 1}, token=token)
        self.assertEqual(code, 400)

    def test_bad_page_key_rejected(self):
        token = login()
        for pk in ["../../etc", "daf:<script>:5", "daf:Chullin:99999", "weird:page"]:
            code, _, _ = call("POST", "/presign", {
                "kind": "worksheet", "pageKey": pk,
                "filename": "x.pdf", "contentType": "application/pdf", "size": 10}, token=token)
            self.assertEqual(code, 400, pk)

    def test_parsha_and_holiday_keys_ok(self):
        token = login()
        for pk in ["parsha:Re'eh", "holiday:Pesach/Passover", "parsha:Ki Sisa"]:
            code, _, _ = call("POST", "/presign", {
                "kind": "worksheet", "pageKey": pk,
                "filename": "x.pdf", "contentType": "application/pdf", "size": 10}, token=token)
            self.assertEqual(code, 200, pk)


class TestMultipartRoutes(Base):
    KEY = "site/uploads/video/daf-chullin-100/1754700000-aabbccdd.mp4"

    def test_sign_part_validates_key(self):
        token = login()
        code, _, _ = call("POST", "/sign-part", {
            "key": "media/203293.mp3", "uploadId": "u", "partNumber": 1}, token=token)
        self.assertEqual(code, 400)

    def test_complete_flow(self):
        token = login()
        lf.s3().create_multipart_upload(Bucket="b", Key=self.KEY)
        code, _, _ = call("POST", "/sign-part", {
            "key": self.KEY, "uploadId": "upload-1", "partNumber": 1}, token=token)
        self.assertEqual(code, 200)
        code, out, _ = call("POST", "/complete", {
            "key": self.KEY, "uploadId": "upload-1",
            "parts": [{"PartNumber": 1, "ETag": '"abc"'}]}, token=token)
        self.assertEqual(code, 200)
        self.assertIn(self.KEY, lf._s3.objects)


class TestMutate(Base):
    def seed(self, key="site/uploads/worksheet/daf-chullin-100/1754700000-aabbccdd.pdf"):
        lf._s3.objects[key] = b"%PDF"
        return key

    def test_add_and_remove_attachment(self):
        token = login()
        key = self.seed()
        code, out, _ = call("POST", "/mutate", {"ops": [{
            "op": "add_attachment", "pageKey": "daf:Chullin:100",
            "title": "מקורות — Daf 100", "key": key,
            "contentType": "application/pdf", "size": 4}]}, token=token)
        self.assertEqual(code, 200)
        atts = out["data"]["attachments"]["pages"]["daf:Chullin:100"]
        self.assertEqual(len(atts), 1)
        self.assertEqual(atts[0]["title"], "מקורות — Daf 100")
        code, out, _ = call("POST", "/mutate", {"ops": [{
            "op": "remove_attachment", "pageKey": "daf:Chullin:100",
            "id": atts[0]["id"]}]}, token=token)
        self.assertEqual(code, 200)
        self.assertNotIn("daf:Chullin:100", out["data"]["attachments"]["pages"])

    def test_attachment_requires_existing_object(self):
        token = login()
        code, out, _ = call("POST", "/mutate", {"ops": [{
            "op": "add_attachment", "pageKey": "daf:Chullin:100",
            "title": "x", "key": "site/uploads/worksheet/x/1754700000-aabbccdd.pdf",
            "contentType": "application/pdf", "size": 1}]}, token=token)
        self.assertEqual(code, 400)

    def test_page_media_override(self):
        token = login()
        key = "site/uploads/video/daf-chullin-100/1754700000-aabbccdd.mp4"
        lf._s3.objects[key] = b"vid"
        code, out, _ = call("POST", "/mutate", {"ops": [{
            "op": "set_page_media", "pageKey": "daf:Chullin:100",
            "kind": "video", "key": key, "label": "Daf 100 (new recording)"}]}, token=token)
        self.assertEqual(code, 200)
        self.assertEqual(out["data"]["media"]["pages"]["daf:Chullin:100"]["video"]["key"], key)
        code, out, _ = call("POST", "/mutate", {"ops": [{
            "op": "clear_page_media", "pageKey": "daf:Chullin:100", "kind": "video"}]}, token=token)
        self.assertEqual(code, 200)
        self.assertNotIn("daf:Chullin:100", out["data"]["media"]["pages"])

    def test_media_key_may_reference_archive(self):
        token = login()
        key = "archive/Daf-Yomi/ מסכת חגיגה/Hebrewbooks_org_37023.pdf"
        lf._s3.objects[key] = b"%PDF"
        code, _, _ = call("POST", "/mutate", {"ops": [{
            "op": "add_attachment", "pageKey": "daf:Chagigah:3", "title": "hebrewbooks",
            "key": key, "contentType": "application/pdf", "size": 4}]}, token=token)
        self.assertEqual(code, 200)

    def test_traversal_and_external_keys_rejected(self):
        token = login()
        for key in ["../secrets", "site/uploads/worksheet/../../x.pdf",
                    "https://evil.example/x.pdf", "/etc/passwd", "build/cloud.config"]:
            code, _, _ = call("POST", "/mutate", {"ops": [{
                "op": "add_attachment", "pageKey": "daf:Chullin:100", "title": "x",
                "key": key, "contentType": "application/pdf", "size": 1}]}, token=token)
            self.assertEqual(code, 400, key)

    def test_script_in_title_stored_but_capped(self):
        token = login()
        key = self.seed()
        code, out, _ = call("POST", "/mutate", {"ops": [{
            "op": "add_attachment", "pageKey": "daf:Chullin:100",
            "title": "A" * 500, "key": key, "contentType": "application/pdf",
            "size": 1}]}, token=token)
        self.assertEqual(code, 400)  # over the 200-char cap

    def test_move_and_rename(self):
        token = login()
        k1, k2 = self.seed(), self.seed("site/uploads/worksheet/daf-chullin-100/1754700001-bbccddee.pdf")
        call("POST", "/mutate", {"ops": [
            {"op": "add_attachment", "pageKey": "daf:Chullin:100", "title": "one",
             "key": k1, "contentType": "application/pdf", "size": 1},
            {"op": "add_attachment", "pageKey": "daf:Chullin:100", "title": "two",
             "key": k2, "contentType": "application/pdf", "size": 1}]}, token=login())
        code, out, _ = call("POST", "/state", token=token)
        # order flip
        d = lf.load_data()
        aid = d["attachments"]["pages"]["daf:Chullin:100"][1]["id"]
        code, out, _ = call("POST", "/mutate", {"ops": [{
            "op": "move_attachment", "pageKey": "daf:Chullin:100", "id": aid, "dir": -1}]},
            token=token)
        self.assertEqual(code, 200)
        self.assertEqual(out["data"]["attachments"]["pages"]["daf:Chullin:100"][0]["id"], aid)
        code, out, _ = call("POST", "/mutate", {"ops": [{
            "op": "rename_attachment", "pageKey": "daf:Chullin:100", "id": aid,
            "title": "renamed"}]}, token=token)
        self.assertEqual(out["data"]["attachments"]["pages"]["daf:Chullin:100"][0]["title"], "renamed")

    def test_history_written(self):
        token = login()
        key = self.seed()
        call("POST", "/mutate", {"ops": [{
            "op": "add_attachment", "pageKey": "daf:Chullin:100", "title": "x",
            "key": key, "contentType": "application/pdf", "size": 1}]}, token=token)
        self.assertTrue(any(k.startswith("site/history/") for k in lf._s3.objects))

    def test_corrupt_data_file_refuses_and_preserves(self):
        token = login()
        lf._s3.objects[lf.DATA_KEY] = b"{not json"
        code, out, _ = call("GET", "/state", token=token)
        self.assertEqual(code, 503)   # never silently reset — that would let a mutate wipe the doc
        self.assertTrue(any(k.startswith("site/history/corrupt-") for k in lf._s3.objects))
        code, _, _ = call("POST", "/mutate", {"ops": [{
            "op": "clear_page_media", "pageKey": "daf:Chullin:100", "kind": "audio"}]}, token=token)
        self.assertEqual(code, 503)
        self.assertEqual(lf._s3.objects[lf.DATA_KEY], b"{not json")  # live doc untouched

    def test_missing_data_file_yields_empty(self):
        token = login()
        code, out, _ = call("GET", "/state", token=token)
        self.assertEqual(code, 200)
        self.assertEqual(out["data"]["media"]["pages"], {})


class TestLectureMedia(Base):
    def test_set_and_clear(self):
        token = login()
        key = "site/uploads/audio/daf-chullin-100/1754700000-aabbccdd.mp3"
        lf._s3.objects[key] = b"aud"
        code, out, _ = call("POST", "/mutate", {"ops": [{
            "op": "set_lecture_media", "lectureId": 457353, "kind": "audio", "key": key}]}, token=token)
        self.assertEqual(code, 200)
        self.assertEqual(out["data"]["media"]["lectures"]["457353"]["audio"]["key"], key)
        code, out, _ = call("POST", "/mutate", {"ops": [{
            "op": "clear_lecture_media", "lectureId": 457353, "kind": "audio"}]}, token=token)
        self.assertEqual(code, 200)
        self.assertNotIn("457353", out["data"]["media"]["lectures"])

    def test_bad_lecture_id(self):
        token = login()
        for lid in ["abc", None, {"x": 1}]:
            code, _, _ = call("POST", "/mutate", {"ops": [{
                "op": "set_lecture_media", "lectureId": lid, "kind": "audio",
                "key": "site/uploads/audio/x/1754700000-aabbccdd.mp3"}]}, token=token)
            self.assertEqual(code, 400, repr(lid))


class TestContent(Base):
    def set(self, values, token=None):
        return call("POST", "/mutate", {"ops": [{"op": "set_content", "values": values}]},
                    token=token or login())

    def test_set_and_clear(self):
        token = login()
        code, out, _ = self.set({"masthead.hebrew": "שיעורי הדף היומי — בית מדרש אור חיים",
                                 "donate.zelle.email": "newzelle@example.com"}, token)
        self.assertEqual(code, 200)
        self.assertEqual(out["data"]["content"]["donate.zelle.email"], "newzelle@example.com")
        code, out, _ = self.set({"masthead.hebrew": ""}, token)   # empty = revert to the file
        self.assertNotIn("masthead.hebrew", out["data"]["content"])
        code, out, _ = call("POST", "/mutate", {"ops": [{"op": "clear_content"}]}, token=token)
        self.assertEqual(out["data"]["content"], {})

    def test_non_allowlisted_keys_rejected(self):
        token = login()
        for key in ["options.mediaBaseUrl", "__proto__", "constructor.prototype.x",
                    "masthead", "media.pages", "masthead.hebrew.evil", "_README"]:
            code, _, _ = self.set({key: "x"}, token)
            self.assertEqual(code, 400, key)

    def test_length_cap(self):
        code, _, _ = self.set({"masthead.hebrew": "א" * 81})
        self.assertEqual(code, 400)

    def test_email_must_look_like_email(self):
        token = login()
        for bad in ["not-an-email", "a b@c.com", "two@@at.com"]:
            code, _, _ = self.set({"contact.email": bad}, token)
            self.assertEqual(code, 400, bad)
        code, _, _ = self.set({"contact.email": "good@example.com"}, token)
        self.assertEqual(code, 200)

    def test_control_chars_rejected_but_newlines_ok_in_blurbs(self):
        token = login()
        code, _, _ = self.set({"masthead.english": "RabbiStern"}, token)
        self.assertEqual(code, 400)
        code, _, _ = self.set({"masthead.english": "Rabbi\nStern"}, token)
        self.assertEqual(code, 400)          # short fields are single-line
        code, _, _ = self.set({"donate.blurb": "line one\nline two"}, token)
        self.assertEqual(code, 200)

    def test_non_string_value_rejected(self):
        code, _, _ = self.set({"masthead.hebrew": {"$ne": None}})
        self.assertEqual(code, 400)

    def test_content_survives_other_ops(self):
        token = login()
        self.set({"masthead.english": "Rabbi Shea Stern"}, token)
        key = "site/uploads/worksheet/daf-chullin-100/1754700000-aabbccdd.pdf"
        lf._s3.objects[key] = b"%PDF"
        code, out, _ = call("POST", "/mutate", {"ops": [{
            "op": "add_attachment", "pageKey": "daf:Chullin:100", "title": "x",
            "key": key, "contentType": "application/pdf", "size": 1}]}, token=token)
        self.assertEqual(out["data"]["content"]["masthead.english"], "Rabbi Shea Stern")

    def test_legacy_doc_without_content_key(self):
        token = login()
        lf._s3.objects[lf.DATA_KEY] = json.dumps({
            "version": 1, "media": {"pages": {}, "lectures": {}},
            "attachments": {"pages": {}}}).encode()          # pre-content-feature doc
        code, out, _ = self.set({"masthead.subtitle": "Monsey"}, token)
        self.assertEqual(code, 200)
        self.assertEqual(out["data"]["content"]["masthead.subtitle"], "Monsey")


class TestDelete(Base):
    def test_delete_only_admin_uploads(self):
        token = login()
        for key in ["media/203293.mp3", "archive/x.pdf", "site/admin-data.json"]:
            code, _, _ = call("POST", "/delete-object", {"key": key}, token=token)
            self.assertEqual(code, 400, key)

    def test_delete_referenced_object_blocked(self):
        token = login()
        key = "site/uploads/worksheet/daf-chullin-100/1754700000-aabbccdd.pdf"
        lf._s3.objects[key] = b"%PDF"
        call("POST", "/mutate", {"ops": [{
            "op": "add_attachment", "pageKey": "daf:Chullin:100", "title": "x",
            "key": key, "contentType": "application/pdf", "size": 1}]}, token=token)
        code, _, _ = call("POST", "/delete-object", {"key": key}, token=token)
        self.assertEqual(code, 400)

    def test_delete_unreferenced_ok(self):
        token = login()
        key = "site/uploads/worksheet/daf-chullin-100/1754700000-aabbccdd.pdf"
        lf._s3.objects[key] = b"%PDF"
        code, _, _ = call("POST", "/delete-object", {"key": key}, token=token)
        self.assertEqual(code, 200)
        self.assertNotIn(key, lf._s3.objects)


class TestPlumbing(Base):
    def test_unknown_route_404(self):
        code, _, _ = call("POST", "/nope", {}, token=login())
        self.assertEqual(code, 404)

    def test_invalid_json_400(self):
        event = {"requestContext": {"http": {"method": "POST", "sourceIp": ""}},
                 "rawPath": "/login", "headers": {}, "body": "{oops"}
        r = lf.lambda_handler(event, None)
        self.assertEqual(r["statusCode"], 400)

    def test_base64_body(self):
        import base64 as b64
        event = {"requestContext": {"http": {"method": "POST", "sourceIp": ""}},
                 "rawPath": "/login", "headers": {},
                 "body": b64.b64encode(json.dumps({"password": "correct-horse"}).encode()).decode(),
                 "isBase64Encoded": True}
        r = lf.lambda_handler(event, None)
        self.assertEqual(r["statusCode"], 200)


if __name__ == "__main__":
    unittest.main()
