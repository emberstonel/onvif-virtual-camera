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
    }

    buildStartupSummary() {
        const lifecycle = this.camera?.lifecycle || {};

        return {
            name: this.cameraConfig.name,
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

        this.camera = this.createCameraRuntime({
            interface: iface,
            ip
        });

        return this.camera;
    }

    async start() {
        logger.info(`Initializing virtual camera: ${this.cameraConfig.name}`);

        const camera = this.resolveRuntime();
        logger.info(`Attempting to bind camera ${camera.name} to ${camera.interface} with IP ${camera.ip}...`);

        this.server = new OnvifServer(camera);
        await this.server.start();

        logger.info(`ONVIF server started for ${camera.name} at ${camera.endpoints.deviceServiceUrl}`);
        return this.buildStartupSummary();
    }
}

module.exports = CameraManager;
