const logger = require("../log-manager");

class MediaService {
    constructor(camera) {
        this.camera = camera;

        // Protect expects exactly one profile with predictable tokens
        this.profileToken = "profile_1";
        this.videoSourceToken = "video_source_1";
        this.videoEncoderToken = "video_encoder_1";
    }

    // ONVIF: GetProfiles
    async GetProfiles() {
        return {
            Profiles: [
                {
                    $: {
                        token: this.profileToken,
                        fixed: "true"
                    },
                    Name: "VirtualProfile",
                    VideoSourceConfiguration: {
                        SourceToken: this.videoSourceToken
                    },
                    VideoEncoderConfiguration: {
                        $: { token: this.videoEncoderToken },
                        Encoding: this.camera.stream.encoding,
                        Resolution: {
                            Width: this.camera.stream.width,
                            Height: this.camera.stream.height
                        },
                        Quality: this.camera.stream.quality,
                        RateControl: {
                            FrameRateLimit: this.camera.stream.framerate,
                            EncodingInterval: 1,
                            BitrateLimit: this.camera.stream.bitrate
                        }
                    }
                }
            ]
        };
    }

    // ONVIF: GetStreamUri
    async GetStreamUri() {
        return {
            MediaUri: {
                Uri: this.camera.rtspUrl,
                InvalidAfterConnect: false,
                InvalidAfterReboot: false,
                Timeout: "PT60S"
            }
        };
    }

    // ONVIF: GetSnapshotUri
    async GetSnapshotUri() {
        return {
            MediaUri: {
                Uri: this.camera.snapshotUrl,
                InvalidAfterConnect: false,
                InvalidAfterReboot: false,
                Timeout: "PT60S"
            }
        };
    }

    // ONVIF: GetVideoSources
    async GetVideoSources() {
        return {
            VideoSources: [
                {
                    $: { token: this.videoSourceToken },
                    Framerate: this.camera.stream.framerate,
                    Resolution: {
                        Width: this.camera.stream.width,
                        Height: this.camera.stream.height
                    }
                }
            ]
        };
    }

    // ONVIF: GetVideoSourceConfiguration
    async GetVideoSourceConfiguration() {
        return {
            VideoSourceConfiguration: {
                $: { token: this.videoSourceToken },
                Name: "VideoSourceConfig",
                UseCount: 1,
                SourceToken: this.videoSourceToken
            }
        };
    }

    // ONVIF: GetVideoEncoderConfiguration
    async GetVideoEncoderConfiguration() {
        return {
            VideoEncoderConfiguration: {
                $: { token: this.videoEncoderToken },
                Name: "VideoEncoderConfig",
                UseCount: 1,
                Encoding: this.camera.stream.encoding,
                Resolution: {
                    Width: this.camera.stream.width,
                    Height: this.camera.stream.height
                },
                Quality: this.camera.stream.quality,
                RateControl: {
                    FrameRateLimit: this.camera.stream.framerate,
                    EncodingInterval: 1,
                    BitrateLimit: this.camera.stream.bitrate
                }
            }
        };
    }

    // ONVIF: GetServiceDefinition
    GetServiceDefinition() {
        return {
            GetProfiles: this.GetProfiles.bind(this),
            GetStreamUri: this.GetStreamUri.bind(this),
            GetSnapshotUri: this.GetSnapshotUri.bind(this),
            GetVideoSources: this.GetVideoSources.bind(this),
            GetVideoSourceConfiguration: this.GetVideoSourceConfiguration.bind(this),
            GetVideoEncoderConfiguration: this.GetVideoEncoderConfiguration.bind(this)
        };
    }

}

module.exports = MediaService;
