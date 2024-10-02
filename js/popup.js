
document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('openOptions').addEventListener('click', function() {
        chrome.runtime.openOptionsPage();
    });

    document.getElementById("moreButton").addEventListener("click", function() {
        chrome.tabs.create({ url: "https://www.idnsl.xyz" });
    });


    document.getElementById("gotoStart").addEventListener("click", function() {
        // 向 content-scripts.js 发送消息，包含关键词信息
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            chrome.tabs.sendMessage(tabs[0].id, { type:"goto_start"});
        });
    });
});