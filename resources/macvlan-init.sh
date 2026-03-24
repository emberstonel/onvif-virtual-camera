#!/usr/bin/env bash
set -euo pipefail

CONFIG_PATH=""
PARENT_IFACE=""
MODE=""
STATIC_IPS=()
CLEANUP_ONLY=false

usage() {
    echo "Usage:"
    echo "  $0 --config <path> --parent <iface> --mode dhcp"
    echo "  $0 --config <path> --parent <iface> --mode static --ips ip1,ip2,ip3"
    echo "  $0 --cleanup"
    echo
    echo "Examples:"
    echo "  $0 --config /opt/onvif-server/config.yaml --parent eth0 --mode dhcp"
    echo "  $0 --config /opt/onvif-server/config.yaml --parent eno1 --mode static --ips 192.168.10.11,192.168.10.12"
    echo "  $0 --cleanup"
    exit 1
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --config)
            CONFIG_PATH="${2:-}"
            shift 2
            ;;
        --parent)
            PARENT_IFACE="${2:-}"
            shift 2
            ;;
        --mode)
            MODE="${2:-}"
            shift 2
            ;;
        --ips)
            IFS=',' read -r -a STATIC_IPS <<< "${2:-}"
            shift 2
            ;;
        --cleanup)
            CLEANUP_ONLY=true
            shift 1
            ;;
        *)
            echo "Unknown argument: $1"
            usage
            ;;
    esac
done

SYSTEMD_NET_DIR="/etc/systemd/network"

cleanup_vcams() {
    echo "[INFO] Cleaning up vcam-* interfaces and systemd-networkd units"

    # Delete interfaces
    for IFACE in $(ip -o link show | awk -F': ' '{print $2}' | grep '^vcam-' || true); do
        echo "[INFO] Removing interface $IFACE"
        ip link delete "$IFACE" || true
    done

    # Delete systemd network files
    if [[ -d "$SYSTEMD_NET_DIR" ]]; then
        for FILE in "$SYSTEMD_NET_DIR"/vcam-*.netdev "$SYSTEMD_NET_DIR"/vcam-*.network; do
            [[ -e "$FILE" ]] || continue
            echo "[INFO] Removing $FILE"
            rm -f "$FILE"
        done
    fi

    # Reload systemd-networkd if present
    if systemctl list-unit-files | grep -q systemd-networkd.service; then
        echo "[INFO] Reloading systemd-networkd"
        systemctl restart systemd-networkd || echo "[WARN] Failed to restart systemd-networkd"
    fi

    echo "[INFO] Cleanup complete."
}

if $CLEANUP_ONLY; then
    cleanup_vcams
    exit 0
fi

# REQUIRED: config path must be provided
if [[ -z "$CONFIG_PATH" ]]; then
    echo "Error: --config <path> is required"
    usage
fi

if [[ ! -f "$CONFIG_PATH" ]]; then
    echo "Error: config file not found: $CONFIG_PATH"
    exit 1
fi

# Validate arguments for normal mode
[[ -z "$PARENT_IFACE" ]] && { echo "Error: --parent is required"; usage; }
[[ -z "$MODE" ]] && { echo "Error: --mode is required"; usage; }

if [[ "$MODE" != "dhcp" && "$MODE" != "static" ]]; then
    echo "Error: --mode must be 'dhcp' or 'static'"
    exit 1
fi

# Ensure systemd-networkd directory exists
if [[ ! -d "$SYSTEMD_NET_DIR" ]]; then
    echo "Error: systemd-networkd directory not found: $SYSTEMD_NET_DIR"
    echo "This script assumes systemd-networkd is available and used for persistence."
    exit 1
fi

# Extract names + MACs from config.yaml
mapfile -t NAMES < <(yq -r '.virtual_cameras[].name' "$CONFIG_PATH")
mapfile -t MACS  < <(yq -r '.virtual_cameras[].mac'  "$CONFIG_PATH")

COUNT=${#NAMES[@]}

if [[ "$MODE" == "static" ]]; then
    if [[ ${#STATIC_IPS[@]} -ne $COUNT ]]; then
        echo "Error: number of static IPs (${#STATIC_IPS[@]}) does not match number of cameras ($COUNT)"
        exit 1
    fi
fi

# Infer CIDR + gateway from parent interface for static mode
PARENT_CIDR=""
PARENT_GW=""

if [[ "$MODE" == "static" ]]; then
    PARENT_CIDR=$(ip -4 addr show "$PARENT_IFACE" | awk '/inet / {print $2}' | head -n1)
    if [[ -z "$PARENT_CIDR" ]]; then
        echo "Error: could not determine IPv4 address/prefix for parent interface $PARENT_IFACE"
        exit 1
    fi

    PARENT_GW=$(ip route | awk -v dev="$PARENT_IFACE" '$1 == "default" && $5 == dev {print $3}' | head -n1)
    if [[ -z "$PARENT_GW" ]]; then
        echo "Error: could not determine default gateway for parent interface $PARENT_IFACE"
        exit 1
    fi

    echo "[INFO] Static mode: using parent CIDR $PARENT_CIDR and gateway $PARENT_GW"
fi

echo "[INFO] Using config: $CONFIG_PATH"
echo "[INFO] Creating $COUNT MacVLAN interfaces on parent '$PARENT_IFACE'"
echo "[INFO] systemd-networkd persistence in $SYSTEMD_NET_DIR"

for i in "${!NAMES[@]}"; do
    NAME="$((i+1))"
    MAC="${MACS[$i]}"
    IFACE="vcam-${NAME}"

    echo "[INFO] Processing $IFACE (MAC $MAC)"

    if ip link show "$IFACE" &>/dev/null; then
        echo "[INFO] Removing existing interface $IFACE"
        ip link delete "$IFACE" || true
    fi

    echo "[INFO] Creating interface $IFACE"
    ip link add "$IFACE" link "$PARENT_IFACE" type macvlan mode bridge
    ip link set "$IFACE" address "$MAC"
    ip link set "$IFACE" up

    if [[ "$MODE" == "dhcp" ]]; then
        echo "[INFO] Requesting DHCP for $IFACE"
        dhclient -v "$IFACE" || echo "[WARN] DHCP failed for $IFACE"
    else
        IP="${STATIC_IPS[$i]}"
        echo "[INFO] Assigning static IP $IP to $IFACE"
        ip addr add "$IP/${PARENT_CIDR#*/}" dev "$IFACE"
    fi

    ip -4 addr show "$IFACE" | grep inet || echo "[WARN] No IPv4 address assigned to $IFACE"

    NETDEV_FILE="$SYSTEMD_NET_DIR/vcam-${NAME}.netdev"
    NETWORK_FILE="$SYSTEMD_NET_DIR/vcam-${NAME}.network"

    echo "[INFO] Writing $NETDEV_FILE"
    cat > "$NETDEV_FILE" <<EOF
[NetDev]
Name=$IFACE
Kind=macvlan

[MACVLAN]
Mode=bridge
EOF

    echo "[INFO] Writing $NETWORK_FILE"
    if [[ "$MODE" == "dhcp" ]]; then
        cat > "$NETWORK_FILE" <<EOF
[Match]
Name=$IFACE

[Link]
MACAddress=$MAC

[Network]
DHCP=yes
EOF
    else
        cat > "$NETWORK_FILE" <<EOF
[Match]
Name=$IFACE

[Link]
MACAddress=$MAC

[Network]
Address=$IP/${PARENT_CIDR#*/}
Gateway=$PARENT_GW
EOF
    fi
done

if systemctl list-unit-files | grep -q systemd-networkd.service; then
    echo "[INFO] Restarting systemd-networkd to apply persistent config"
    systemctl restart systemd-networkd || echo "[WARN] Failed to restart systemd-networkd"
else
    echo "[WARN] systemd-networkd.service not found; persistence files are written but not applied automatically"
fi

echo "[INFO] MacVLAN setup complete."
