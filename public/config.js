// 百度地图「浏览器端」AK 不提交到 git：
// 新建 public/config.local.js（已在 .gitignore 中），内容为：
//   window.APP_CONFIG.BAIDU_AK = '你的AK';
window.APP_CONFIG = {
  BAIDU_AK: '',
  CITY: '成都市',
  CENTER: [104.0665, 30.5723], // 天府广场附近
  ZOOM: 12
};
