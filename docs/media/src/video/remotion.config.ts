import { Config } from '@remotion/cli/config';

// Formato de salida: H.264 en .mp4, pensado para quedar por debajo de 10 MB
// (fondo oscuro y colores planos comprimen muy bien).
Config.setCodec('h264');
Config.setCrf(23);
Config.setPixelFormat('yuv420p');
Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(90);
Config.setOverwriteOutput(true);

// El póster se genera con `npm run poster` (remotion still).
Config.setStillImageFormat('png');
