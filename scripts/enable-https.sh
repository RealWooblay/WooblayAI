#!/bin/bash
# Enable HTTPS on the ALB once the ACM certificate is validated.
# Usage: ./scripts/enable-https.sh
set -euo pipefail

REGION="us-east-1"
CERT_ARN="arn:aws:acm:us-east-1:050752647977:certificate/11ca6d93-7a52-4fdd-a93a-2735446ffe98"
ALB_ARN=$(aws elbv2 describe-load-balancers --names wooblay-alb --query "LoadBalancers[0].LoadBalancerArn" --output text --region "$REGION")
TG_ARN=$(aws elbv2 describe-target-groups --load-balancer-arn "$ALB_ARN" --query "TargetGroups[?TargetGroupName=='wooblay-gate-tg'].TargetGroupArn" --output text --region "$REGION")

echo "Checking certificate status..."
STATUS=$(aws acm describe-certificate --certificate-arn "$CERT_ARN" --query "Certificate.Status" --output text --region "$REGION")

if [ "$STATUS" != "ISSUED" ]; then
  echo "Certificate status: $STATUS (needs to be ISSUED)"
  echo "Update your GoDaddy nameservers to Route53 and wait for DNS propagation."
  exit 1
fi

echo "Certificate is ISSUED. Adding HTTPS listener..."

# Add HTTPS listener on port 443
aws elbv2 create-listener \
  --load-balancer-arn "$ALB_ARN" \
  --protocol HTTPS \
  --port 443 \
  --certificates "CertificateArn=$CERT_ARN" \
  --default-actions "Type=forward,TargetGroupArn=$TG_ARN" \
  --ssl-policy "ELBSecurityPolicy-TLS13-1-2-2021-06" \
  --region "$REGION"

echo "HTTPS listener added."

# Modify HTTP listener to redirect to HTTPS
HTTP_LISTENER_ARN=$(aws elbv2 describe-listeners --load-balancer-arn "$ALB_ARN" --query "Listeners[?Port==\`80\`].ListenerArn" --output text --region "$REGION")

aws elbv2 modify-listener \
  --listener-arn "$HTTP_LISTENER_ARN" \
  --default-actions 'Type=redirect,RedirectConfig={Protocol=HTTPS,Port=443,StatusCode=HTTP_301}' \
  --region "$REGION"

echo "HTTP → HTTPS redirect enabled."

# Update ALB security group to allow 443
SG_ID=$(aws elbv2 describe-load-balancers --names wooblay-alb --query "LoadBalancers[0].SecurityGroups[0]" --output text --region "$REGION")

aws ec2 authorize-security-group-ingress \
  --group-id "$SG_ID" \
  --protocol tcp \
  --port 443 \
  --cidr 0.0.0.0/0 \
  --region "$REGION" 2>/dev/null || echo "Port 443 already open in security group"

echo ""
echo "Done! wooblay.com and app.wooblay.com now serve over HTTPS."
echo "Visit: https://wooblay.com"
