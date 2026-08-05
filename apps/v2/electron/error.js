const { desktop } = window;
const messageElement = document.getElementById('msg');
messageElement.textContent = new URLSearchParams(location.search).get('msg') || '未知错误';

document.getElementById('retry').onclick = async () => {
  try {
    await desktop.restartApi();
    messageElement.textContent = '本地服务已恢复。请关闭本窗口，再通过系统托盘图标打开主窗口。';
  } catch (error) {
    messageElement.textContent = '重试失败：' + (error && error.message ? error.message : String(error));
  }
};

document.getElementById('quit').onclick = () => {
  desktop.quit();
};
