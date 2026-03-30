const logger = require("./log-manager");
const networkManager = require("./network-manager");
const OnvifServer = require("./onvif-server");

const DEFAULT_ONVIF_PORT = 80;
const DEFAULT_RTSP_PROXY_PORT = 8554;

class CameraManager {
    constructor(cameraConfig) {
        this.cameraConfig = cameraConfig;
        this.camera = null;
        this.server = null;
        this.monitorTimer = null;
        this.restarting = false;
    }

    buildStartupSummary() {
        const lifecycle = this.camera?.lifecycle || {};

        return {
            name: this.cameraConfig.name,
            mac: this.cameraConfig.mac,
            requestedIp: this.cameraConfig.ipAssignment?.value || null,
            sourceHost: this.cameraConfig.host?.hostname || null,
            interface: this.camera?.interface || null,
            ip: this.camera?.ip || null,
            deviceServiceUrl: this.camera?.endpoints?.deviceServiceUrl || null,
            mediaServiceUrl: this.camera?.endpoints?.mediaServiceUrl || null,
            rtspUri: this.camera?.endpoints?.rtspUri || null,
            snapshotUri: this.camera?.endpoints?.snapshotUri || null,
            lifecycle: {
                configLoaded: !!lifecycle.configLoaded,
                networkResolved: !!lifecycle.networkResolved,
                httpReady: !!lifecycle.httpReady,
                snapshotReady: !!lifecycle.snapshotReady,
                rtspProxyReady: !!lifecycle.rtspProxyReady,
                discoveryReady: !!lifecycle.discoveryReady
            }
        };
    }

    createCameraRuntime(network) {
        const onvifPort = this.cameraConfig.onvifPort || DEFAULT_ONVIF_PORT;
        const rtspProxyPort = this.cameraConfig.rtspProxyPort || DEFAULT_RTSP_PROXY_PORT;

        return {
            ...this.cameraConfig,
            interface: network.interface,
            ip: network.ip,
            onvifPort,
            rtspProxyPort,
            endpoints: {
                deviceServiceUrl: `http://${network.ip}:${onvifPort}/onvif/device_service`,
                mediaServiceUrl: `http://${network.ip}:${onvifPort}/onvif/media_service`,
                rtspUri: `rtsp://${network.ip}:${rtspProxyPort}${this.cameraConfig.rtspPath}`,
                snapshotUri: `http://${network.ip}:${onvifPort}${this.cameraConfig.snapshotPath}`
            },
            source: {
                hostname: this.cameraConfig.host.hostname,
                rtspPort: this.cameraConfig.host.rtsp_port,
                snapshotUrl: this.cameraConfig.snapshotUrl,
                snapshotPath: this.cameraConfig.snapshotPath,
                rtspUrl: this.cameraConfig.rtspUrl
            },
            identity: this.cameraConfig.identity,
            lifecycle: {
                configLoaded: true,
                networkResolved: true,
                rtspProxyReady: false,
                httpReady: false,
                snapshotReady: false,
                discoveryReady: false
            }
        };
    }

    resolveRuntime() {
        const iface = networkManager.findInterfaceByMac(this.cameraConfig.mac);
        const ip = networkManager.getInterfaceIp(iface);

        if (this.cameraConfig.ipAssignment?.mode === "static" && this.cameraConfig.ipAssignment.address !== ip) {
            throw new Error(`Configured static IP for ${this.cameraConfig.name} does not match live interface address: ${this.cameraConfig.ipAssignment.value} vs ${ip}`);
        }

        this.camera = this.createCameraRuntime({
            interface: iface,
            ip
        });

        return this.camera;
    }

    resolveNetwork() {
        const iface = networkManager.findInterfaceByMac(this.cameraConfig.mac);
        const ip = networkManager.getInterfaceIp(iface);

        return {
            interface: iface,
            ip
        };
    }

    async handleNetworkChange(network) {
        if (this.restarting) {
            return;
        }

        this.restarting = true;

        try {
            const previousInterface = this.camera?.interface || "<unknown>";
            const previousIp = this.camera?.ip || "<unknown>";

            logger.info(
                `Detected network change for ${this.cameraConfig.name}: ` +
                `${previousInterface}/${previousIp} -> ${network.interface}/${network.ip}; restarting camera services`
            );

            if (this.server) {
                await this.server.stop();
            }

            this.camera = this.createCameraRuntime(network);
            this.server = new OnvifServer(this.camera);
            await this.server.start();

            logger.info(`Camera ${this.camera.name} rebound to ${this.camera.interface} with IP ${this.camera.ip}`);
        } catch (err) {
            logger.error(`Failed to refresh camera ${this.cameraConfig.name} after network change: ${err.message}`);
        } finally {
            this.restarting = false;
        }
    }

    startMonitoring() {
        if (this.monitorTimer) {
            return;
        }

        if (this.cameraConfig.ipAssignment?.mode !== "dhcp") {
            logger.debug('network', `Skipping IP monitor for ${this.cameraConfig.name} ` + `(static=${this.cameraConfig.ipAssignment?.value || "<unknown>"})`);
            return;
        }

        const intervalMs = global.runtime?.ip_monitor_interval_ms || 15000;

        this.monitorTimer = setInterval(async () => {
            if (!this.camera || this.restarting) {
                return;
            }

            try {
                const network = this.resolveNetwork();
                const interfaceChanged = network.interface !== this.camera.interface;
                const ipChanged = network.ip !== this.camera.ip;

                if (interfaceChanged || ipChanged) {
                    await this.handleNetworkChange(network);
                }
            } catch (err) {
                logger.error(`Failed to refresh network state for ${this.cameraConfig.name}: ${err.message}`);
            }
        }, intervalMs);

        if (typeof this.monitorTimer.unref === "function") {
            this.monitorTimer.unref();
        }

        logger.info(`Started IP monitoring for ${this.cameraConfig.name} (interval=${intervalMs}ms)`);
    }

    async start() {
        logger.info(`Initializing virtual camera: ${this.cameraConfig.name}`);

        const camera = this.resolveRuntime();
        logger.info(`Attempting to bind camera ${camera.name} to ${camera.interface} with IP ${camera.ip}...`);

        this.server = new OnvifServer(camera);
        await this.server.start();
        this.startMonitoring();

        logger.info(`ONVIF server started for ${camera.name} at ${camera.endpoints.deviceServiceUrl}`);
        return this.buildStartupSummary();
    }
}

module.exports = CameraManager;
