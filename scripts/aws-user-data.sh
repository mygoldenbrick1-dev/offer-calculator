#!/bin/bash
set -euo pipefail

fallocate -l 1G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

dnf install -y nodejs22 nodejs22-npm unzip
if ! command -v aws >/dev/null; then dnf install -y awscli-2; fi

install -d -o ec2-user -g ec2-user /opt/offer-calculator
aws s3 cp s3://offer-calculator-deploy-117984642146-use2/release.zip /tmp/offer-calculator.zip --region us-east-2
unzip -q /tmp/offer-calculator.zip -d /opt/offer-calculator
cd /opt/offer-calculator
npm ci --no-audit --no-fund
aws ssm get-parameter --name /offer-calculator/housecanary --with-decryption --query Parameter.Value --output text --region us-east-2 > credentials.json
chown -R ec2-user:ec2-user /opt/offer-calculator
chmod 600 credentials.json
install -m 0644 scripts/offer-calculator.service /etc/systemd/system/offer-calculator.service
systemctl daemon-reload
systemctl enable --now offer-calculator