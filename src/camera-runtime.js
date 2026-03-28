const DEFAULT_ONVIF_PORT = 80;
const DEFAULT_RTSP_PROXY_PORT = 8554;

function createCameraRuntime(cameraConfig, network) {
    const onvifPort = cameraConfig.onvifPort || DEFAULT_ONVIF_PORT;
    const rtspProxyPort = cameraConfig.rtspProxyPort || DEFAULT_RTSP_PROXY_PORT;

    return {
        ...cameraConfig,
        interface: network.interface,
        ip: network.ip,
        onvifPort,
        rtspProxyPort,
        endpoints: {
            deviceServiceUrl: `http://${network.ip}:${onvifPort}/onvif/device_service`,
            mediaServiceUrl: `http://${network.ip}:${onvifPort}/onvif/media_service`,
            rtspUri: `rtsp://${network.ip}:${rtspProxyPort}${cameraConfig.rtspPath}`,
            snapshotUri: cameraConfig.snapshotUrl
        },
        source: {
            hostname: cameraConfig.host.hostname,
            rtspPort: cameraConfig.host.rtsp_port,
            snapshotUrl: cameraConfig.snapshotUrl,
            rtspUrl: cameraConfig.rtspUrl
        },
        lifecycle: {
            configLoaded: true,
            networkResolved: true,
            rtspProxyReady: false,
            httpReady: false,
            discoveryReady: false
        }
    };
}

module.exports = {
    DEFAULT_ONVIF_PORT,
    DEFAULT_RTSP_PROXY_PORT,
    createCameraRuntime
};
