#!/usr/bin/env bash
# =============================================================================
# 在 Azure Cloud Shell 里运行：创建资源组 + Ubuntu VM（含自动初始化）
#
# 用法（Cloud Shell 里）：
#   chmod +x create-vm.sh && ./create-vm.sh
# 或改参数：
#   LOCATION=japaneast SIZE=Standard_B2ats_v2 ./create-vm.sh
#
# 规格说明（Azure for Students）：
#   Standard_B2ats_v2  2 vCPU / 8 GB（AMD x86_64）→ 750 小时/月免费
#   Standard_B1s       1 vCPU / 1 GB              → 免费但内存不够跑 5 个容器
#   Standard_B2pts_v2  2 vCPU / 8 GB（ARM64）     → 免费，但部分镜像需重新构建，不推荐
# =============================================================================
set -euo pipefail

RG="${RG:-shiguang-rg}"
LOCATION="${LOCATION:-eastasia}"
VM_NAME="${VM_NAME:-shiguang-vm}"
SIZE="${SIZE:-Standard_B2ats_v2}"
ADMIN="${ADMIN:-azureuser}"
DISK_GB="${DISK_GB:-64}"
DEPLOY_ENTRYPOINT="${DEPLOY_ENTRYPOINT:-tls}"
case "$DEPLOY_ENTRYPOINT" in
  tls|tunnel) ;;
  *) echo "DEPLOY_ENTRYPOINT 只支持 tls 或 tunnel。" >&2; exit 2 ;;
esac

echo "=============================================="
echo " 资源组: $RG"
echo " 区域  : $LOCATION"
echo " VM    : $VM_NAME ($SIZE, ${DISK_GB}GB 系统盘)"
echo " 用户  : $ADMIN"
echo "=============================================="

if ! az account show >/dev/null 2>&1; then
  echo "请先登录：az login"
  exit 1
fi

echo "==> 当前订阅"
az account show --query "{name:name, id:id, state:state}" -o table

echo "==> 创建/复用资源组"
az group create -n "$RG" -l "$LOCATION" -o none
echo "OK"

CLOUD_INIT=$(mktemp /tmp/cloud-init-XXXX.yaml)
cat > "$CLOUD_INIT" <<YAML
#cloud-config
package_update: true
packages:
  - curl
  - ca-certificates
  - unzip
  - git
  - jq
  - htop
  - openssl

swap:
  filename: /swapfile
  size: 4G
  maxsize: 4G

write_files:
  - path: /etc/docker/daemon.json
    owner: root:root
    permissions: '0644'
    content: |
      {
        "log-driver": "json-file",
        "log-opts": {"max-size": "50m", "max-file": "3"}
      }

runcmd:
  - [ sh, -c, "curl -fsSL https://get.docker.com | sh" ]
  - [ systemctl, enable, --now, docker ]
  - [ sh, -c, "usermod -aG docker $ADMIN || true" ]
  - [ sh, -c, "mkdir -p /opt/shiguang && chown $ADMIN:$ADMIN /opt/shiguang" ]
  - [ sh, -c, "date -Is > /opt/shiguang/.cloud-init-done" ]
YAML

echo "==> 创建 VM（约 1-2 分钟）"
az vm create \
  -g "$RG" -n "$VM_NAME" \
  --image Ubuntu2204 \
  --size "$SIZE" \
  --admin-username "$ADMIN" \
  --generate-ssh-keys \
  --custom-data "$CLOUD_INIT" \
  --public-ip-sku Standard \
  --public-ip-address-allocation static \
  --os-disk-size-gb "$DISK_GB" \
  --storage-sku StandardSSD_LRS \
  --nsg-rule SSH \
  -o table

if [[ "$DEPLOY_ENTRYPOINT" == tls ]]; then
  echo "==> 开放直接 TLS 入口的 80 / 443"
  az vm open-port -g "$RG" -n "$VM_NAME" --port 80 --priority 1010 -o none
  az vm open-port -g "$RG" -n "$VM_NAME" --port 443 --priority 1020 -o none
fi

IP=$(az vm show -d -g "$RG" -n "$VM_NAME" --query publicIps -o tsv)
rm -f "$CLOUD_INIT"

cat <<EOF

==============================================
 部署信息
==============================================
 公网 IP : $IP
 SSH     : ssh $ADMIN@$IP
 成本    : 该规格 750 小时/月免费，系统盘 ${DISK_GB}GB + 静态 IP 走 \$100 额度

 下一步：
 1) 等 3-5 分钟让 cloud-init 装好 Docker
       ssh $ADMIN@$IP 'cloud-init status --wait; docker --version'
 2) 本机上传部署包
       scp campus-life-release.tar.gz campus-life-release.tar.gz.sha256 $ADMIN@$IP:/opt/shiguang/
 3) 登录服务器执行部署
       scp deploy-app.sh $ADMIN@$IP:/opt/shiguang/
       参照 azure/README-azure.md 准备生产配置和 $DEPLOY_ENTRYPOINT 入口后运行部署脚本。
==============================================
EOF
