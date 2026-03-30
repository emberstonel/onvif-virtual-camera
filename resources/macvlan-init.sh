#!/usr/bin/env bash
set -euo pipefail

CONFIG_PATH=""
PARENT_IFACE=""
CLEANUP_ONLY=false
DHCP_FAIL=false

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNTIME_SCRIPT="$SCRIPT_DIR/macvlan-runtime.sh"
SERVICE_FILE="/etc/systemd/system/onvif-macvlan.service"


usage() {
    echo "Usage:"
    echo "  $0 --config <path> --parent <iface>"
    echo "  $0 --cleanup"
    exit 1
}

cleanup() {
    echo "[INFO] Stopping systemd service if running..."
    systemctl stop onvif-macvlan.service 2>/dev/null || true

    echo "[INFO] Removing vcam-* interfaces..."
    for IFACE in $(ip -o link show | awk -F': ' '/vcam-/ {print $2}'); do
        NAME=$(cut -d '@' -f 1 <<< "$IFACE")
        echo "[INFO] Deleting interface $IFACE"
        ip link delete "$NAME" 2>/dev/null || true
    done

    echo "[INFO] Removing runtime script and service..."
    rm -f "$RUNTIME_SCRIPT" || true
    rm -f "$SERVICE_FILE" || true

    echo "[INFO] Reloading systemd..."
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
        --cleanup) CLEANUP_ONLY=true; shift 1 ;;
        *) echo "Unknown argument: $1"; usage ;;
    esac
done
if $CLEANUP_ONLY; then
    cleanup
    exit 0
fi
echo "[INFO] Processing config file '$CONFIG_PATH' using $PARENT_IFACE."

# Argument validation
[[ -z "$CONFIG_PATH" ]] && { echo "Error: --config <path> is required"; usage; }
[[ ! -f "$CONFIG_PATH" ]] && { echo "Error: config file not found: $CONFIG_PATH"; exit 1; }

[[ -z "$PARENT_IFACE" ]] && { echo "Error: --parent is required"; usage; }
if ! ip link show "$PARENT_IFACE" &>/dev/null; then
    echo "Error: parent interface not found: $PARENT_IFACE"
    exit 1
fi

echo "[INFO] Reading virtual camera definitions from config."

# Extract names + MACs from config.yaml
mapfile -t NAMES < <(yq -r '.virtual_cameras[].name' "$CONFIG_PATH")
mapfile -t MACS  < <(yq -r '.virtual_cameras[].mac'  "$CONFIG_PATH")
mapfile -t IPS   < <(yq -r '.virtual_cameras[].ip'   "$CONFIG_PATH")

COUNT=${#NAMES[@]}
echo "[INFO] Found $COUNT virtual cameras in config."

if [[ ${#IPS[@]} -ne $COUNT ]]; then
    echo "Error: every virtual camera must define an ip value"
    exit 1
fi

# Enable promiscuous mode on the parent interface
ip link set "$PARENT_IFACE" promisc on

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
        IP_ASSIGNMENT="${IPS[$i]}"
        IFACE="vcam-${NAME}"

        echo "# --- $IFACE ---"
        echo "ip link delete \"$IFACE\" 2>/dev/null || true"
        echo "ip link add \"$IFACE\" link \"\$PARENT_IFACE\" type macvlan mode bridge"
        echo "ip link set \"$IFACE\" address \"$MAC\""
        echo "ip link set \"$IFACE\" up"

        if [[ "${IP_ASSIGNMENT^^}" == "DHCP" ]]; then
            echo "sleep 1.5"
            if command -v dhcpcd >/dev/null 2>&1; then
                echo "dhcpcd -4 -I -G -C --config /dev/null \"$IFACE\""
            elif command -v dhclient >/dev/null 2>&1; then
                echo "dhclient -4 -v -cf /dev/null \"$IFACE\""
            elif command -v udhcpc >/dev/null 2>&1; then
                echo "udhcpc -i \"$IFACE\" -n -q"
            else
                DHCP_FAIL=true
            fi
        else
            echo "ip addr add \"$IP_ASSIGNMENT\" dev \"$IFACE\" || true"
        fi

        echo ""
    done

} > "$RUNTIME_SCRIPT"

if $DHCP_FAIL; then
    echo "[WARN] DHCP mode enabled but a DHCP client could not be found. Try installing 'dhcpcd' first (eg 'apt install dhcpcd')."
fi

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
