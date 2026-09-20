/**
 * 门派驻地经纬度配置（前端补充，后端不存储坐标）。
 * key 为门派 id；缺少配置的门派不会在舆图上标注。
 */
export interface SectGeo {
  lng: number;
  lat: number;
}

export const SECT_GEO: Record<string, SectGeo> = {
  // 武当派 - 湖北武当山
  '1': { lng: 111.0, lat: 32.4 },
  // 少林派 - 河南嵩山
  '2': { lng: 112.96, lat: 34.48 },
  // 峨眉派 - 四川峨眉山
  '3': { lng: 103.33, lat: 29.52 },
  // 昆仑派 - 新疆昆仑山
  '4': { lng: 85.2, lat: 36.6 },
  // 华山派 - 陕西华山
  '5': { lng: 110.09, lat: 34.49 },
  // 崆峒派 - 甘肃崆峒山
  '6': { lng: 106.52, lat: 35.56 },
};
