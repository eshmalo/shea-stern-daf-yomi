#!/bin/bash
# deploy.sh — create/update the monseydafyomi.com admin API on AWS Lambda.
#
#   ./deploy.sh                 # deploy (creates everything on first run)
#   ./deploy.sh --new-password  # deploy AND rotate the admin password (prints it once)
#
# Reads R2 credentials from ../build/cloud.config. Persists the generated
# ADMIN_PW_HASH + SESSION_SECRET in admin-api/.secrets (git-ignored) so
# redeploys don't rotate them unless asked.
set -euo pipefail
cd "$(dirname "$0")"

REGION=us-west-2
FN=dafyomi-admin-api
ROLE=dafyomi-admin-lambda-role
ORIGINS="https://monseydafyomi.com,https://eshmalo.github.io,http://localhost:8788"

# --- R2 config from the pipeline's cloud.config ---
cfg() { grep -E "^$1=" ../build/cloud.config 2>/dev/null | head -1 | cut -d= -f2- || true; }
S3_ENDPOINT_URL=$(cfg S3_ENDPOINT_URL); S3_BUCKET=$(cfg S3_BUCKET)
R2_KEY=$(cfg AWS_ACCESS_KEY_ID); R2_SECRET=$(cfg AWS_SECRET_ACCESS_KEY)
CDN_BASE_URL=$(cfg CDN_BASE_URL)
[ -n "$S3_ENDPOINT_URL" ] && [ -n "$R2_KEY" ] || { echo "build/cloud.config incomplete"; exit 1; }

# --- secrets (generate once, keep across deploys) ---
touch .secrets && chmod 600 .secrets
get() { grep -E "^$1=" .secrets 2>/dev/null | head -1 | cut -d= -f2- || true; }
SESSION_SECRET=$(get SESSION_SECRET)
if [ -z "$SESSION_SECRET" ]; then
  SESSION_SECRET=$(python3 -c "import secrets;print(secrets.token_hex(32))")
  echo "SESSION_SECRET=$SESSION_SECRET" >> .secrets
fi
ADMIN_PW_HASH=$(get ADMIN_PW_HASH)
if [ -z "$ADMIN_PW_HASH" ] || [ "${1:-}" = "--new-password" ]; then
  read -r PW ADMIN_PW_HASH <<< "$(python3 - <<'EOF'
import secrets, hashlib
words = ("gemara shiur daf yomi torah mishna rashi tosfos sugya masechta "
         "chazara halacha mesivta kollel seder amud blatt perek chabura maggid").split()
# 3 words + 6 hex chars ≈ 37 bits — with 600k-iteration PBKDF2 that is far
# beyond online brute force even across many Lambda containers
pw = "-".join(secrets.choice(words) for _ in range(3)) + "-" + secrets.token_hex(3)
salt = secrets.token_bytes(16)
h = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, 600_000)
print(pw, f"pbkdf2$600000${salt.hex()}${h.hex()}")
EOF
)"
  # rotating the password also rotates SESSION_SECRET so every old session dies
  SESSION_SECRET=$(python3 -c "import secrets;print(secrets.token_hex(32))")
  umask 077
  printf 'SESSION_SECRET=%s\nADMIN_PW_HASH=%s\n' "$SESSION_SECRET" "$ADMIN_PW_HASH" > .secrets
  chmod 600 .secrets
  echo ""
  echo "  ============================================================"
  echo "  NEW ADMIN PASSWORD (write it down — it is not stored):"
  echo ""
  echo "      $PW"
  echo ""
  echo "  ============================================================"
  echo ""
fi

# --- IAM role (logs only; R2 access is via env keys, not IAM) ---
if ! aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  aws iam create-role --role-name "$ROLE" --assume-role-policy-document '{
    "Version":"2012-10-17","Statement":[{"Effect":"Allow",
    "Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  aws iam attach-role-policy --role-name "$ROLE" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  echo "created IAM role $ROLE; waiting for propagation…"; sleep 10
fi
ROLE_ARN=$(aws iam get-role --role-name "$ROLE" --query Role.Arn --output text)

# --- package + create/update function ---
rm -f fn.zip && zip -q fn.zip lambda_function.py
ENV_JSON=$(DEPLOY_EP="$S3_ENDPOINT_URL" DEPLOY_BUCKET="$S3_BUCKET" DEPLOY_KEY="$R2_KEY" \
  DEPLOY_SECRET="$R2_SECRET" DEPLOY_CDN="$CDN_BASE_URL" DEPLOY_HASH="$ADMIN_PW_HASH" \
  DEPLOY_SESS="$SESSION_SECRET" DEPLOY_ORIGINS="$ORIGINS" python3 - <<'EOF'
import json, os
e = os.environ
print(json.dumps({"Variables": {
  "S3_ENDPOINT_URL": e["DEPLOY_EP"], "S3_BUCKET": e["DEPLOY_BUCKET"],
  "R2_ACCESS_KEY_ID": e["DEPLOY_KEY"], "R2_SECRET_ACCESS_KEY": e["DEPLOY_SECRET"],
  "CDN_BASE_URL": e["DEPLOY_CDN"], "ADMIN_PW_HASH": e["DEPLOY_HASH"],
  "SESSION_SECRET": e["DEPLOY_SESS"], "ALLOWED_ORIGINS": e["DEPLOY_ORIGINS"]}}))
EOF
)
if aws lambda get-function --function-name "$FN" --region $REGION >/dev/null 2>&1; then
  aws lambda update-function-code --function-name "$FN" --region $REGION \
    --zip-file fileb://fn.zip >/dev/null
  aws lambda wait function-updated --function-name "$FN" --region $REGION
  aws lambda update-function-configuration --function-name "$FN" --region $REGION \
    --environment "$ENV_JSON" --timeout 30 --memory-size 256 >/dev/null
  aws lambda wait function-updated --function-name "$FN" --region $REGION
else
  aws lambda create-function --function-name "$FN" --region $REGION \
    --runtime python3.12 --handler lambda_function.lambda_handler \
    --role "$ROLE_ARN" --zip-file fileb://fn.zip \
    --environment "$ENV_JSON" --timeout 30 --memory-size 256 >/dev/null
  aws lambda wait function-active --function-name "$FN" --region $REGION
fi

# --- public endpoint: API Gateway HTTP API (Lambda function URLs return 403
# for anonymous callers on this account, so we front with API GW instead) ---
API_ID=$(aws apigatewayv2 get-apis --region $REGION \
  --query "Items[?Name=='$FN'].ApiId | [0]" --output text)
if [ "$API_ID" = "None" ] || [ -z "$API_ID" ]; then
  FN_ARN=$(aws lambda get-function --function-name "$FN" --region $REGION \
    --query Configuration.FunctionArn --output text)
  ACCT=$(aws sts get-caller-identity --query Account --output text)
  API_ID=$(aws apigatewayv2 create-api --name "$FN" --protocol-type HTTP \
    --target "$FN_ARN" --region $REGION --query ApiId --output text)
  aws lambda add-permission --function-name "$FN" --region $REGION \
    --statement-id apigw-invoke --action lambda:InvokeFunction \
    --principal apigateway.amazonaws.com \
    --source-arn "arn:aws:execute-api:$REGION:$ACCT:$API_ID/*" >/dev/null
fi
URL="https://$API_ID.execute-api.$REGION.amazonaws.com"

# --- R2 bucket CORS (browser needs GET for manifests + PUT for presigned uploads) ---
python3 - "$ORIGINS" <<'EOF'
import json, subprocess, sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.getcwd()), "build"))
sys.path.insert(0, "../build")
import cloud
cfg = cloud.load_config()
cors = {"CORSRules": [{
    "AllowedOrigins": sys.argv[1].split(","),
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600}]}
subprocess.run(["aws", "s3api", "put-bucket-cors", "--endpoint-url", cfg["S3_ENDPOINT_URL"],
                "--bucket", cfg["S3_BUCKET"], "--cors-configuration", json.dumps(cors)],
               env=cloud._env(cfg), check=True)
print("R2 bucket CORS configured")
# lifecycle: reap abandoned multipart uploads after 3 days; expire admin-data
# history after a year (tiny files, but keep the bucket tidy)
lc = {"Rules": [
    {"ID": "abort-stale-multipart", "Status": "Enabled", "Filter": {"Prefix": "site/uploads/"},
     "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 3}},
    {"ID": "expire-admin-history", "Status": "Enabled", "Filter": {"Prefix": "site/history/"},
     "Expiration": {"Days": 365}}]}
subprocess.run(["aws", "s3api", "put-bucket-lifecycle-configuration", "--endpoint-url", cfg["S3_ENDPOINT_URL"],
                "--bucket", cfg["S3_BUCKET"], "--lifecycle-configuration", json.dumps(lc)],
               env=cloud._env(cfg), check=True)
print("R2 lifecycle rules configured")
EOF

rm -f fn.zip
echo ""
echo "Deployed: $URL"
echo "Put this URL in admin/config.js (window.ADMIN_API_URL)."
