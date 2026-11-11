/* Keep this file ES5-compatible and external so the existing CSP permits it.
 * Only browser/version and fixed error codes are displayed; no private content,
 * cookies, URLs or raw exception messages are collected or sent anywhere. */
(function () {
  var fallback;
  var failure;
  function show(code) {
    var root = document.getElementById("root");
    if (!root || root.getAttribute("data-app-ready") === "true") return;
    var status = document.getElementById("startup-status");
    if (!status && fallback) {
      root.appendChild(fallback.cloneNode(true));
    }
    var label = document.getElementById("startup-code");
    var browser = document.getElementById("startup-browser");
    if (label) label.textContent = code + "（CM-BOOT-2）";
    if (browser) browser.textContent = navigator.userAgent;
  }
  window.addEventListener("error", function (event) {
    if (event.target && event.target.tagName && event.target.tagName !== "SCRIPT") return;
    failure = event.target && event.target.tagName === "SCRIPT"
      ? "启动脚本下载失败"
      : "启动脚本运行失败";
    show(failure);
  }, true);
  function initialize() {
    var status = document.getElementById("startup-status");
    if (status) fallback = status.cloneNode(true);
    show(failure || "正在加载启动脚本");
    window.setTimeout(function () {
      show(failure || "启动尚未完成，请检查网络或浏览器兼容性");
    }, 15000);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize);
  } else {
    initialize();
  }
}());
