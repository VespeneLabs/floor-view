import { gasAssets } from '@vespenelabs/floorview/gas';
import { kenneyAssets } from '@vespenelabs/floorview/kenney';

/**
 * The 3D models markers can show: the library's Gas kit and Kenney catalog. Their files (`assets/`
 * in the repo) are Studio's public folder, so they are served from `<base>/gas/…` and `<base>/kenney/…`.
 */
export const ASSETS = [
  ...gasAssets(`${import.meta.env.BASE_URL}gas`),
  ...kenneyAssets(`${import.meta.env.BASE_URL}kenney`),
];
