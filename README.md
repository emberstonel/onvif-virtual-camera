# ONVIF Virtual Camera (Docker Edition)

This project provides a lightweight ONVIF Device + Media Service emulator designed for UniFi Protect and other ONVIF clients. It is ideal for cameras that contain multiple "heads" or expose various angles as separate cameras.

Each virtual camera exposes:

- ONVIF Device Service  
- ONVIF Media Service  
- RTSP stream URL  
- Snapshot URL  

The container can run multiple virtual cameras, each bound to a unique MacVLAN interface with its own IP address. RTSP proxying is not required as the full RTSP paths (to the original host device) are passed in the ONVIF replies. Note that this fork is focused on **Docker deployment**.

---

## Features

- No external dependencies  
- Multiple virtual ONVIF cameras in one container
- Helper script to build MacVLAN interfaces based on your config
- Fully compatible with UniFi Protect’s ONVIF discovery  
- RTSP + snapshot URLs mapped from real host cameras  

---

## Requirements

- Docker or Docker Compose  
- A MacVLAN interface for each virtual camera  
- A `config.yaml` mounted into the container root as `/config.yaml`  

---

## Getting Started

- Create a `config.yaml` defining your virtual cameras.
- Run the `macvlan-init.sh` script to create the required macvlan interfaces.
- Build the Docker image for the ONVIF proxy.
- Run the container and mount your `config.yaml` into `/config.yaml`.
- Add each virtual camera to UnFi Protect.

---

# Configuration File (`config.yaml`)

Paths for the virtual cameras are relative to the "hostname" entered as a host source. This file must be mounted into the container root as:

```
/config.yaml
```

A complete example:

```yaml
host_sources:
  - name: cam1
    hostname: 192.168.1.50
    rtsp_port: 554
    http_port: 80
    auth:
      username: admin
      password: password123

  - name: cam2
    hostname: 192.168.1.51
    rtsp_port: 554
    http_port: 80
    auth:
      username: admin
      password: password123

virtual_cameras:
  - name: VirtualCam1
    model: "VCam-1080p"
    mac: "02:42:ac:11:00:11"
    host_source: cam1
    rtsp_path: "/live1"
    snapshot_path: "/snapshot1.jpg"

  - name: VirtualCam2
    model: "VCam-1080p"
    mac: "02:42:ac:11:00:12"
    host_source: cam1
    rtsp_path: "/live2"
    snapshot_path: "/snapshot2.jpg"

  - name: VirtualCam3
    model: "VCam-1080p"
    mac: "02:42:ac:11:00:13"
    host_source: cam2
    rtsp_path: "/live"
    snapshot_path: "/snapshot.jpg"
```

---


## MacVLAN Setup (Required)

Each virtual camera must appear on the network as a **unique MAC + IP**.  
This project includes a helper script that automates creation and persistence of these interfaces which is should work on most common Linux distributions (Ubuntu, Debian, Arch, Fedora, etc.). Feel free to complete the MacVLAN setup yourself if preferred.

The script performs:

- Creation of `vcam-<name>` MacVLAN interfaces  
- Assignment of MAC addresses from `config.yaml`  
- DHCP or static IP assignment  
- Immediate activation of the interfaces  
- A cleanup mode to remove all vcam interfaces and persistence files  

This makes it easy to rebuild interfaces when changing MACs or when UniFi Protect gets “stuck” on a previous adoptions.

> **NOTE:** The script requires the YAML parser `yq` to be installed on the host system. This can be done via `apt install yq`

---

### Running the Script

The script must be run **on the host**, not inside the container. It can be copied to your host system using the following (if your container name differs, adjust `onvif-server` accordingly):

```bash
docker cp onvif-server:/resources/macvlan-init.sh ./macvlan-init.sh
chmod +x ./macvlan-init.sh
```

Arguments expected by this script:

- The path to your config.yaml
- A parent interface (e.g., `eth0`, `eno1`, `enp3s0`)  
- A mode (`dhcp` or `static`)  
- Optional static IPs  

Examples below.

---

### DHCP Mode (Recommended)

This is the simplest and most common setup.

```bash
sudo ./resources/macvlan-init.sh \
    --config "/opt/onvif-server/config.yaml" \
    --parent eth0 \
    --mode dhcp
```

The script will:

- Read all virtual cameras from your `/config.yaml`
- Create `vcam-<name>` interfaces
- Assign MAC addresses
- Request DHCP leases
- Generate persistent systemd‑networkd files
- Restart systemd‑networkd to apply them

---

### Static Mode

If you prefer static IPs, provide them in the same order the virtual cameras appear in your config:

```bash
sudo ./resources/macvlan-init.sh \
    --config "/opt/onvif-server/config.yaml" \
    --parent eth0 \
    --mode static \
    --ips 192.168.10.11,192.168.10.12
```

Static mode automatically:

- Infers the subnet mask and gateway from the **parent interface**
- Writes persistent `.network` files with `Address=` and `Gateway=`
- No need to specify CIDR or gateway manually.

---

# Docker Usage

## Docker Compose Example

```yaml
services:
  onvif-server:
    build:
      context: .
      target: prod                        # use "dev" for troubleshooting / debugging
    container_name: onvif-server
    network_mode: "host"
    restart: unless-stopped
    volumes:
      - ./config.yaml:/config.yaml:ro
```

### Why `network_mode: host`?

Because each virtual camera binds to its own **MacVLAN interface** on the host.  
The container must see the host’s network stack directly.

---

# Running

Build and start:

```
docker compose up --build -d
```

View logs:

```
docker logs -f onvif-server
```
---

# Adding Cameras to UniFi Protect

1. Verify the Docker container is running without errors (review logs)
2. Log into UniFi Protect and navigate to the "Devices" section
3. TBD
4. TBD
5. TBD