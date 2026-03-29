# ONVIF Virtual Camera

This project creates virtual ONVIF cameras for UniFi Protect. It is intended for sources that Protect cannot adopt cleanly on its own, including cameras without useful ONVIF support and multi-head cameras that need to appear as separate devices.

Each virtual camera gets its own:

- MAC address
- IP address
- ONVIF Device Service
- ONVIF Media Service
- RTSP endpoint
- Snapshot endpoint

The project is designed to run in Docker with host networking. Each virtual camera is bound to its own MacVLAN interface so UniFi Protect can adopt it as an individual device.

## Getting Started

1. Create a `config.yml` for your host sources and virtual cameras.
2. Create the required MacVLAN interfaces on the Docker host.
3. Start the container with host networking and mount the config as `/config.yml`.
4. Check the container logs to confirm each virtual camera started successfully.
5. Add the virtual camera IPs in UniFi Protect.

## Configuration

This project uses a YAML config file, usually named `config.yml`, placed alongside your Docker deployment files. Ensure it is mounted into the container as shown in the Docker Usage section below.

Use [resources/config-example.yml](./resources/config-example.yml) as the starting point for your file.

### Runtime Settings

```yaml
runtime:
  enable_debug_logs: false
  probe_streams: true
  probe_timeout_ms: 15000
```

- `enable_debug_logs`: `false`, `true`, or an array of debug categories
- `probe_streams`: probe source streams with `ffprobe` when a camera does not define a `stream` block
- `probe_timeout_ms`: timeout for probing

### Host Sources

Each host source describes the `real` camera or recorder endpoint:

```yaml
host_sources:
  - name: nvr-1
    hostname: 192.168.1.50
    rtsp_port: 554
    http_port: 80
    auth:
      username: admin
      password: secret
```

### Virtual Cameras

Each virtual camera requires:

- `name`
- `model`
- `mac`
- `host_source`
- `rtsp_path`
- `snapshot_path`

Optional identity fields:

- `manufacturer`
- `firmware_version`
- `serial_number`
- `hardware_id`

Optional manual stream settings:

```yaml
stream:
  encoding: "H264"
  width: 1920
  height: 1080
  framerate: 15
  bitrate: 2048
  quality: 5
```

If `stream` is present, it must be complete and probing is skipped for that camera. If `stream` is omitted, probing is used when `runtime.probe_streams` is enabled.

## MacVLAN Setup

Each virtual camera must appear as a separate device on the network with its own unique MAC and IP address for successful adoption by UniFi Protect (v7.0.94). A MacVLAN helper script is included in the Docker image to simplify this setup, but it must be copied to the host before use.

The helper script:

- creates `vcam-<name>` interfaces
- applies the configured MAC addresses
- assigns DHCP or static IPs
- can clean up generated interfaces and persistence files

> [!CAUTION]
> The script must be run on the host, not inside the container.

> [!WARNING]
> MacVLANs are required for this project and they must be configured to match your config.yml exactly. Using the helper script is highly recommended.

### Using the helper script for setup

Start or create the container first, then copy the helper script to the host (if your container name differs, adjust "onvif-server" in the command below accordingly).

```bash
docker cp onvif-server:/app/resources/macvlan-init.sh ./macvlan-init.sh
chmod +x ./macvlan-init.sh
```

Example DHCP mode:

```bash
sudo ./macvlan-init.sh \
    --config "/opt/onvif-server/config.yml" \
    --parent eth0 \
    --mode dhcp
```

Example static mode:

```bash
sudo ./macvlan-init.sh \
    --config "/opt/onvif-server/config.yml" \
    --parent eth0 \
    --mode static \
    --ips 192.168.10.11,192.168.10.12
```

## Docker Usage

Example Docker Compose configuration:

```yaml
services:
  onvif-server:
    image: ghcr.io/emberstonel/onvif-server
    container_name: onvif-server
    network_mode: host
    restart: unless-stopped
    volumes:
      - ./config.yml:/config.yml:ro
```

> [!NOTE]
> `network_mode: host` is required because the container needs direct access to the host MacVLAN interfaces.

## Running

Start the container:

```bash
docker compose up --build -d
```

View logs:

```bash
docker logs -f onvif-server
```

On a successful startup, expect to see:

- configuration loaded
- one initialization attempt per virtual camera
- one short success line per virtual camera showing MAC, interface, and IP
- a final initialization complete line

If startup fails, the logs should point to the relevant stage, such as config validation, interface lookup, bind failure, or source probing.

## Adding Cameras to UniFi Protect

1. Open the add-third-party-camera flow in UniFi Protect.
2. Use the virtual camera IP address, not the upstream source IP.
3. Enter the source credentials if the camera requires authentication.
4. Repeat for each virtual camera identity you configured.

## Notes

- RTSP is proxied locally so Protect receives stream URIs from the adopted device identity.
- Snapshot requests are also served locally by the virtual camera.
- WSDL and XSD assets are stored locally in the repository, so runtime behavior does not depend on remote ONVIF schema URLs.
