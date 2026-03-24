#!/usr/bin/env bash
set -euo pipefail

CONFIG_PATH=""
PARENT_IFACE=""
MODE=""
STATIC_IPS=()
CLEANUP_ONLY=false

RUNTIME_SCRIPT="/opt/onvif/macvlan-runtime.sh"
SERVICE_FILE="/etc/systemd/system/onvif-macvlan.service"

usage() {
    echo "Usage:"
    echo "  $0 --config <path> --parent <iface> --mode dhcp"
    echo "  $0 --config <path> --parent <iface> --mode static --ips ip1,ip2,ip3"
    echo "  $0 --cleanup"
    exit 1
}

cleanup() {
    echo "[INFO] Removing runtime script and service"

    rm -f "$RUNTIME_SCRIPT" || true
    rm -f "$SERVICE_FILE" || true

    systemctl daemon-reload || true
    echo "[INFO] Cleanup complete."
}

echo "[INFO] Starting macvlan-init helper..."
echo "[INFO] Validating configurations."

# Validate yq is available
if ! command -v yq >/dev/null 2>&1; then
    echo "Error: 'yq' is required but not installed."
    echo "Install it with: sudo apt install yq (Debian/Ubuntu)"
    exit 1
fi

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --config) CONFIG_PATH="${2:-}"; shift 2 ;;
        --parent) PARENT_IFACE="${2:-}"; shift 2 ;;
        --mode) MODE="${2:-}"; shift 2 ;;
        --ips) IFS=',' read -r -a STATIC_IPS <<< "${2:-}"; shift 2 ;;
        --cleanup) CLEANUP_ONLY=true; shift 1 ;;
        *) echo "Unknown argument: $1"; usage ;;
    esac
done
if $CLEANUP_ONLY; then
    cleanup
    exit 0
fi
echo "[INFO] Processing config file `$CONFIG_PATH` using $PARENT_IFACE."

# Argument validation
[[ -z "$CONFIG_PATH" ]] && { echo "Error: --config <path> is required"; usage; }
[[ ! -f "$CONFIG_PATH" ]] && { echo "Error: config file not found: $CONFIG_PATH"; exit 1; }

[[ -z "$PARENT_IFACE" ]] && { echo "Error: --parent is required"; usage; }
[[ -z "$MODE" ]] && { echo "Error: --mode is required"; usage; }

if [[ "$MODE" != "dhcp" && "$MODE" != "static" ]]; then
    echo "Error: --mode must be 'dhcp' or 'static'"
    exit 1
fi
if ! ip link show "$PARENT_IFACE" &>/dev/null; then
    echo "Error: parent interface not found: $PARENT_IFACE"
    exit 1
fi

echo "[INFO] Reading virtual camera definitions from config."

# Extract names + MACs from config.yaml
mapfile -t NAMES < <(yq -r '.virtual_cameras[].name' "$CONFIG_PATH")
mapfile -t MACS  < <(yq -r '.virtual_cameras[].mac'  "$CONFIG_PATH")

COUNT=${#NAMES[@]}
echo "[INFO] Found $COUNT virtual cameras in config."

# Infer CIDR and gateway from parent interface for static mode
PARENT_CIDR=""
PARENT_GW=""

if [[ "$MODE" == "static" ]]; then
    if [[ ${#STATIC_IPS[@]} -ne $COUNT ]]; then
        echo "Error: number of static IPs does not match number of cameras"
        exit 1
    fi
    echo "[INFO] Setup continuing in static mode: ${#STATIC_IPS[@]} IPs provided."
    echo "[INFO] Inferring network settings from parent interface $PARENT_IFACE..."

    PARENT_CIDR=$(ip -4 addr show "$PARENT_IFACE" | awk '/inet / {print $2}' | head -n1)
    [[ -z "$PARENT_CIDR" ]] && { echo "Error: could not determine IPv4 for $PARENT_IFACE"; exit 1; }

    PARENT_GW=$(ip route | awk -v dev="$PARENT_IFACE" '$1 == "default" && $5 == dev {print $3}' | head -n1)
    [[ -z "$PARENT_GW" ]] && { echo "Error: could not determine gateway for $PARENT_IFACE"; exit 1; }

    echo "[INFO] Static mode: using parent CIDR $PARENT_CIDR and gateway $PARENT_GW"
else
    echo "[INFO] Setup continuing in DHCP mode."
fi

# Create runtime script used by the service
echo "[INFO] Generating runtime script: $RUNTIME_SCRIPT"

{
    echo "#!/usr/bin/env bash"
    echo "set -euo pipefail"
    echo ""
    echo "PARENT_IFACE=\"$PARENT_IFACE\""
    echo ""

    for i in "${!NAMES[@]}"; do
        NAME="$((i+1))"
        MAC="${MACS[$i]}"
        IFACE="vcam-${NAME}"

        echo "# --- $IFACE ---"
        echo "ip link delete \"$IFACE\" 2>/dev/null || true"
        echo "ip link add \"$IFACE\" link \"\$PARENT_IFACE\" type macvlan mode bridge"
        echo "ip link set \"$IFACE\" address \"$MAC\""
        echo "ip link set \"$IFACE\" up"

        if [[ "$MODE" == "static" ]]; then
            IP="${STATIC_IPS[$i]}"
            echo "ip addr add \"$IP/${PARENT_CIDR#*/}\" dev \"$IFACE\" || true"
        fi

        echo ""
    done

    if [[ "$MODE" == "dhcp" ]]; then
        echo "# DHCP mode: rely on system DHCP client"
        echo "# If needed, uncomment:"
        echo "# dhclient vcam-*"
    fi

} > "$RUNTIME_SCRIPT"

chmod +x "$RUNTIME_SCRIPT"
echo "[INFO] Runtime script created and marked executable."

# Create and start the service
echo "[INFO] Writing systemd service: $SERVICE_FILE"

{
    echo "[Unit]"
    echo "Description=Create MacVLAN interfaces for ONVIF virtual cameras"
    echo "After=network-online.target"
    echo "Wants=network-online.target"
    echo ""
    echo "[Service]"
    echo "Type=oneshot"
    echo "ExecStart=$RUNTIME_SCRIPT"
    echo "RemainAfterExit=yes"
    echo ""
    echo "[Install]"
    echo "WantedBy=multi-user.target"
} > "$SERVICE_FILE"

echo "[INFO] Reloading systemd..."
systemctl daemon-reload

echo "[INFO] Enabling and starting service..."
systemctl enable --now onvif-macvlan.service

echo "[INFO] Setup complete."