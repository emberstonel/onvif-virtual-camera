#!/usr/bin/env bash
set -euo pipefail

CONFIG_PATH=""
PARENT_IFACE=""
MODE=""
STATIC_IPS=()
CLEANUP_ONLY=false
PARENT_NETWORK_FILE=""   # NEW: global variable

usage() {
    echo "Usage:"
    echo "  $0 --config <path> --parent <iface> --mode dhcp"
    echo "  $0 --cleanup"
    exit 1
}

# Validation function for networkd
is_networkd_available() {
    if systemctl is-active --quiet systemd-networkd || \
       systemctl is-active --quiet systemd-networkd.socket; then
        return 0
    else
        return 1
    fi
}

# Detect actual parent .network file
get_parent_network_file() {
    local file
    file=$(basename "$(readlink -f "$SYSTEMD_NET_DIR"/*-"$PARENT_IFACE".network 2>/dev/null || true)")
    if [[ -z "$file" ]]; then
        return 1
    fi
    echo "$file"
    return 0
}

# Validate networkd is active
if ! is_networkd_available; then
    echo "[ERROR] systemd-networkd is not running."
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

SYSTEMD_NET_DIR="/etc/systemd/network"
PARENT_NETWORK_FILE=$(get_parent_network_file || true)

if [[ -z "$PARENT_NETWORK_FILE" ]]; then
    echo "[ERROR] Could not locate parent .network file for interface $PARENT_IFACE"
    echo "[ERROR] Expected something like: /etc/systemd/network/10-$PARENT_IFACE.network"
    exit 1
fi

cleanup_vcams() {
    echo "[INFO] Cleaning up vcam-* interfaces and systemd-networkd units"

    # Delete interfaces
    for IFACE in $(ip -o link show | awk -F': ' '{print $2}' | sed 's/@.*//' | grep '^vcam-' || true); do
        echo "[INFO] Removing interface $IFACE"
        ip link delete "$IFACE" || true
    done

    # Delete systemd network files
    if [[ -d "$SYSTEMD_NET_DIR" ]]; then
        for FILE in "$SYSTEMD_NET_DIR"/001-vcam-*.netdev "$SYSTEMD_NET_DIR"/002-vcam-*.network; do
            [[ -e "$FILE" ]] || continue
            echo "[INFO] Removing $FILE"
            rm -f "$FILE"
        done
    fi

    # Remove correct parent drop-in directory
    PARENT_DROPIN_DIR="$SYSTEMD_NET_DIR/${PARENT_NETWORK_FILE}.d"
    if [[ -d "$PARENT_DROPIN_DIR" ]]; then
        echo "[INFO] Removing drop-in directory $PARENT_DROPIN_DIR"
        rm -rf "$PARENT_DROPIN_DIR"
    fi

    # Reload systemd-networkd
    if is_networkd_available; then
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
    exit 1
fi

# Extract names + MACs from config.yaml
mapfile -t NAMES < <(yq -r '.virtual_cameras[].name' "$CONFIG_PATH")
mapfile -t MACS  < <(yq -r '.virtual_cameras[].mac'  "$CONFIG_PATH")

COUNT=${#NAMES[@]}

if [[ "$MODE" == "static" ]]; then
    if [[ ${#STATIC_IPS[@]} -ne $COUNT ]]; then
        echo "Error: number of static IPs does not match number of cameras"
        exit 1
    fi
fi

# Infer CIDR + gateway from parent interface for static mode
PARENT_CIDR=""
PARENT_GW=""

if [[ "$MODE" == "static" ]]; then
    PARENT_CIDR=$(ip -4 addr show "$PARENT_IFACE" | awk '/inet / {print $2}' | head -n1)
    [[ -z "$PARENT_CIDR" ]] && { echo "Error: could not determine IPv4 for $PARENT_IFACE"; exit 1; }

    PARENT_GW=$(ip route | awk -v dev="$PARENT_IFACE" '$1 == "default" && $5 == dev {print $3}' | head -n1)
    [[ -z "$PARENT_GW" ]] && { echo "Error: could not determine gateway for $PARENT_IFACE"; exit 1; }

    echo "[INFO] Static mode: using parent CIDR $PARENT_CIDR and gateway $PARENT_GW"
fi

echo "[INFO] Using config: $CONFIG_PATH"
echo "[INFO] Creating $COUNT MacVLAN interfaces on parent '$PARENT_IFACE'"
echo "[INFO] systemd-networkd persistence in $SYSTEMD_NET_DIR"

INTERFACES=()

for i in "${!NAMES[@]}"; do
    NAME="$((i+1))"
    MAC="${MACS[$i]}"
    IFACE="vcam-${NAME}"
    INTERFACES+=("$IFACE")

    echo "[INFO] Processing $IFACE (MAC $MAC)"

    if ip link show "$IFACE" &>/dev/null; then
        EXISTING_MAC=$(cat /sys/class/net/"$IFACE"/address)
        if [[ "$EXISTING_MAC" == "${MAC,,}" ]]; then
            echo "[INFO] $IFACE already exists with correct MAC; skipping"
            continue
        else
            echo "[INFO] $IFACE exists but MAC differs; recreating"
            ip link delete "$IFACE" || true
        fi
    fi

    echo "[INFO] Creating interface $IFACE"
    ip link add "$IFACE" link "$PARENT_IFACE" type macvlan mode bridge
    ip link set "$IFACE" address "$MAC"
    ip link set "$IFACE" up

    if [[ "$MODE" == "dhcp" ]]; then
        echo "[INFO] DHCP will be used for $IFACE"
    else
        IP="${STATIC_IPS[$i]}"
        echo "[INFO] Assigning static IP $IP to $IFACE"
        ip addr add "$IP/${PARENT_CIDR#*/}" dev "$IFACE"
    fi

    NETDEV_FILE="$SYSTEMD_NET_DIR/001-vcam-${NAME}.netdev"
    NETWORK_FILE="$SYSTEMD_NET_DIR/002-vcam-${NAME}.network"

    echo "[INFO] Writing $NETDEV_FILE"
    cat > "$NETDEV_FILE" <<EOF
[Match]
Name=$PARENT_IFACE

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

# Parent .network drop-in logic using detected filename
PARENT_DROPIN_DIR="$SYSTEMD_NET_DIR/${PARENT_NETWORK_FILE}.d"
mkdir -p "$PARENT_DROPIN_DIR"

DROPIN_FILE="$PARENT_DROPIN_DIR/onvif-macvlan.conf"

echo "[INFO] Writing parent drop-in: $DROPIN_FILE"
{
    echo "[Network]"
    for IFACE in "${INTERFACES[@]}"; do
        echo "MACVLAN=$IFACE"
    done
} > "$DROPIN_FILE"

# Restart network if required
if is_networkd_available; then
    echo "[INFO] Restarting systemd-networkd to apply persistent config"
    networkctl reload || echo "[WARN] Failed to reload systemd-networkd"
fi

echo "[INFO] Verifying interface IP assignments..."

for i in "${!INTERFACES[@]}"; do
    IFACE="${INTERFACES[$i]}"

    if [[ "$MODE" == "dhcp" ]]; then
        for attempt in {1..10}; do
            IP=$(ip -4 addr show "$IFACE" | awk '/inet / {print $2}')
            if [[ -n "$IP" ]]; then
                echo "[INFO] $IFACE is up with IP $IP"
                break
            fi
            [[ $attempt -eq 10 ]] && echo "[WARN] $IFACE has no IPv4 address after timeout" || sleep 1
        done
    else
        IP=$(ip -4 addr show "$IFACE" | awk '/inet / {print $2}')
        [[ -n "$IP" ]] && echo "[INFO] $IFACE is up with IP $IP" || echo "[WARN] $IFACE exists but has no IPv4 address"
    fi
done

echo "[INFO] MacVLAN setup complete."
