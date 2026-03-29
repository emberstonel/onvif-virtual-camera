const fs = require("fs");
const { spawnSync } = require("child_process");
const yaml = require("js-yaml");
const logger = require("./log-manager");

function hasAuth(object) {
    return !!(
        object.auth &&
        object.auth.username &&
        object.auth.password
    );
}

function getDefaultRuntime() {
    return {
        enable_debug_logs: false,
        probe_streams: true,
        probe_timeout_ms: 15000
    };
}

function getDefaultStreamConfig() {
    return {
        encoding: "H264",
        width: 1920,
        height: 1080,
        framerate: 15,
        bitrate: 2048,
        quality: 5
    };
}

function getMinimumStreamConfig() {
    return {
        framerate: 5
    };
}

function loadConfig(configPath) {
    if (!fs.existsSync(configPath)) {
        throw new Error(`Config file not found at ${configPath}`);
    }

    let raw;
    try {
        raw = fs.readFileSync(configPath, "utf8");
    } catch (err) {
        throw new Error(`Failed to read config file: ${err.message}`);
    }

    let config;
    try {
        config = yaml.load(raw);
    } catch (err) {
        logger.error(`Failed to parse config file as YAML: ${err.message}`);
        throw new Error(`Failed to parse YAML: ${err.message}`);
    }

    // Validate top-level structure
    if (!config.host_sources || !Array.isArray(config.host_sources)) {
        throw new Error("Config must contain 'host_sources' as an array.");
    }

    if (!config.virtual_cameras || !Array.isArray(config.virtual_cameras)) {
        throw new Error("Config must contain 'virtual_cameras' as an array.");
    }

    // Set runtime values
    const runtime = {
        ...getDefaultRuntime(),
        ...(config.runtime || {})
    };
    validateRuntimeSettings(runtime);
    global.runtime = Object.freeze(runtime);

    // Build host source lookup map
    const sourcesByName = {};
    for (const src of config.host_sources) {
        validateHostSource(src);

        if (sourcesByName[src.name]) {
            throw new Error(`Duplicate host_source name '${src.name}' found in config.`);
        }

        sourcesByName[src.name] = {
            hostname: src.hostname,
            rtsp_port: src.rtsp_port,
            http_port: src.http_port,
            auth: hasAuth(src) ? {
                username: src.auth.username,
                password: src.auth.password
            } : null
        };
    }

    // Resolve virtual cameras
    const seenCameraNames = new Set();
    const seenCameraMacs = new Set();

    const cameras = config.virtual_cameras.map((cam) => {
        validateVirtualCamera(cam);

        if (seenCameraNames.has(cam.name)) {
            throw new Error(`Duplicate virtual_camera name '${cam.name}' found in config.`);
        }
        seenCameraNames.add(cam.name);

        const source = sourcesByName[cam.host_source];
        if (!source) {
            throw new Error(
                `Virtual camera '${cam.name}' references unknown host_source '${cam.host_source}'.`
            );
        }

        // Normalize MAC
        const mac = cam.mac.toLowerCase();
        if (seenCameraMacs.has(mac)) {
            throw new Error(`Duplicate virtual_camera MAC '${mac}' found in config.`);
        }
        seenCameraMacs.add(mac);

        // Ensure paths start with '/'
        const rtspPath = cam.rtsp_path.startsWith("/")
            ? cam.rtsp_path
            : `/${cam.rtsp_path}`;

        const snapshotPath = cam.snapshot_path.startsWith("/")
            ? cam.snapshot_path
            : `/${cam.snapshot_path}`;

        // Construct full URLs with optional authentication
        const authPrefix = hasAuth(source)
            ? `${encodeURIComponent(source.auth.username)}:${encodeURIComponent(source.auth.password)}@`
            : "";

        // RTSP URL
        const rtspUrl =
            `rtsp://${authPrefix}${source.hostname}:${source.rtsp_port}${rtspPath}`;

        // Snapshot URL
        const snapshotUrl =
            `http://${authPrefix}${source.hostname}:${source.http_port}${snapshotPath}`;

        // Construct our camera object
        const camera = {
            name: cam.name,
            model: cam.model,
            mac,
            rtspPath,
            snapshotPath,
            rtspUrl,
            snapshotUrl,
            streamConfig: normalizeConfiguredStream(cam.stream),
            identity: normalizeIdentity(cam),
            auth: hasAuth(source) ? {
                username: source.auth.username,
                password: source.auth.password
            } : null,
            host: {
                hostname: source.hostname,
                rtsp_port: source.rtsp_port,
                http_port: source.http_port
            }
        };

        // Fetch stream config
        camera.stream = resolveStreamDetails(camera, runtime);

        return camera;
    });

    return { runtime, cameras };
}

function resolveStreamDetails(cam, runtime) {
    const defaults = getDefaultStreamConfig();
    const configured = cam.streamConfig || {};

    if (cam.streamConfig) {
        logger.info(`Skipping ffprobe for '${cam.name}' because stream config was provided`);
        return {
            ...defaults,
            ...configured
        };
    }

    if (!runtime.probe_streams) {
        logger.info(`Skipping ffprobe for '${cam.name}' because runtime.probe_streams=false`);
        return {
            ...defaults,
            ...configured
        };
    }

    const probed = fetchStreamDetails(cam, runtime);
    return {
        ...defaults,
        ...probed,
        ...configured
    };
}

function fetchStreamDetails(cam, runtime) {
    const defaults = getDefaultStreamConfig();
    const minimums = getMinimumStreamConfig();
    const ffprobePath = process.env.FFPROBE_PATH || "/usr/bin/ffprobe";
    logger.debug('config', `Using ffprobe path: ${ffprobePath}`);

    logger.debug('config', `Calling ffprobe with URL: ${cam.rtspUrl}`);
    const result = spawnSync(
        ffprobePath,
        [
            "-v", "error",
            "-rtsp_transport", "tcp",
            "-select_streams", "v:0",
            "-show_entries", "stream=codec_name,width,height,avg_frame_rate,bit_rate",
            "-of", "json",
            cam.rtspUrl
        ],
        {
            encoding: "utf8",
            timeout: runtime.probe_timeout_ms
        }
    );

    if (result.error) {
        logger.warn(`ffprobe failed for '${cam.name}': ${result.error.message}; using defaults`);
        return defaults;
    }

    if (result.status !== 0) {
        logger.warn(
            `ffprobe returned non-zero for '${cam.name}': ` +
            `${(result.stderr || "").trim() || `exit ${result.status}`}; using defaults`
        );
        return defaults;
    }

    let parsed;
    try {
        parsed = JSON.parse(result.stdout);
    } catch (err) {
        logger.warn(`Failed to parse ffprobe output for '${cam.name}': ${err.message}; using defaults`);
        return defaults;
    }

    const stream = parsed?.streams?.[0];
    if (!stream) {
        logger.warn(`ffprobe returned no video stream for '${cam.name}'; using defaults`);
        return defaults;
    }

    const parseFrameRate = (value) => {
        const [num, den] = String(value || "").split("/", 2).map(Number);
        if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) {
            return null;
        }

        const fps = num / den;
        return Number.isFinite(fps) && fps > 0 ? Math.round(fps) : null;
    };

    const codecMap = {
        h264: "H264",
        hevc: "H265",
        h265: "H265",
        mjpeg: "MJPEG"
    };

    const detected = {
        encoding: codecMap[String(stream.codec_name || "").toLowerCase()] || defaults.encoding,
        width: Number.isFinite(stream.width) && stream.width > 0 ? stream.width : defaults.width,
        height: Number.isFinite(stream.height) && stream.height > 0 ? stream.height : defaults.height,
        framerate: Math.max(parseFrameRate(stream.avg_frame_rate) || defaults.framerate, minimums.framerate),
        bitrate: Number.isFinite(Number(stream.bit_rate)) && Number(stream.bit_rate) > 0
            ? Math.round(Number(stream.bit_rate) / 1000)
            : defaults.bitrate,
        quality: defaults.quality
    };

    logger.debug('config', `Detected stream details for '${cam.name}': ${detected.encoding}, ${detected.width}x${detected.height}, ${detected.framerate}fps, ${detected.bitrate}kbps`);

    return detected;
}

function normalizeConfiguredStream(stream) {
    if (stream === undefined || stream === null) {
        return null;
    }

    const normalized = {
        encoding: stream.encoding,
        width: normalizePositiveInteger(stream.width, "stream.width"),
        height: normalizePositiveInteger(stream.height, "stream.height"),
        framerate: normalizePositiveInteger(stream.framerate, "stream.framerate"),
        bitrate: normalizePositiveInteger(stream.bitrate, "stream.bitrate"),
        quality: normalizePositiveNumber(stream.quality, "stream.quality")
    };

    const requiredKeys = ["encoding", "width", "height", "framerate", "bitrate", "quality"];
    const missingKeys = requiredKeys.filter((key) => normalized[key] === undefined);
    if (missingKeys.length > 0) {
        throw new Error(`stream config is missing required field(s): ${missingKeys.join(", ")}.`);
    }

    return normalized;
}

function normalizeIdentity(cam) {
    return {
        manufacturer: normalizeOptionalString(cam.manufacturer, "manufacturer") || "VirtualCam",
        model: normalizeOptionalString(cam.model, "model") || cam.name,
        firmwareVersion: normalizeOptionalString(cam.firmware_version, "firmware_version") || "1.0",
        serialNumber: normalizeOptionalString(cam.serial_number, "serial_number")
            || cam.mac.replace(/:/g, "").toUpperCase(),
        hardwareId: normalizeOptionalString(cam.hardware_id, "hardware_id")
            || normalizeOptionalString(cam.model, "model")
            || cam.mac.replace(/:/g, "").toUpperCase()
    };
}

function validateRuntimeSettings(runtime) {
    if (typeof runtime.probe_streams !== "boolean") {
        throw new Error("runtime.probe_streams must be true or false.");
    }

    normalizePositiveInteger(runtime.probe_timeout_ms, "runtime.probe_timeout_ms");
}

function validateHostSource(src) {
    const required = ["name", "hostname", "rtsp_port", "http_port"];
    for (const key of required) {
        if (!src[key]) {
            throw new Error(`host_source missing required field '${key}'.`);
        }
    }

    if (src.auth) {
        const hasUsername = !!src.auth.username;
        const hasPassword = !!src.auth.password;

        if (hasUsername !== hasPassword) {
            throw new Error(
                "host_source.auth must contain both username and password if either is specified."
            );
        }
    }

    normalizePositiveInteger(src.rtsp_port, `host_source '${src.name}'.rtsp_port`);
    normalizePositiveInteger(src.http_port, `host_source '${src.name}'.http_port`);
}

function validateVirtualCamera(cam) {
    const required = ["name", "model", "mac", "host_source", "rtsp_path", "snapshot_path"];
    for (const key of required) {
        if (!cam[key]) {
            throw new Error(`virtual_camera missing required field '${key}'.`);
        }
    }

    if (!/^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/.test(cam.mac)) {
        throw new Error(`virtual_camera '${cam.name}' has invalid MAC address '${cam.mac}'.`);
    }

    if (cam.stream) {
        normalizeConfiguredStream(cam.stream);
    }

    normalizeIdentity(cam);
}

function normalizePositiveInteger(value, label) {
    if (value === undefined || value === null) {
        return undefined;
    }

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${label} must be a positive integer.`);
    }

    return parsed;
}

function normalizePositiveNumber(value, label) {
    if (value === undefined || value === null) {
        return undefined;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`${label} must be a positive number.`);
    }

    return parsed;
}

function normalizeOptionalString(value, label) {
    if (value === undefined || value === null) {
        return undefined;
    }

    if (typeof value !== "string") {
        throw new Error(`${label} must be a string.`);
    }

    const trimmed = value.trim();
    if (trimmed === "") {
        throw new Error(`${label} must not be empty.`);
    }

    return trimmed;
}

module.exports = { loadConfig };
