
document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('openOptions').addEventListener('click', function() {
        chrome.runtime.openOptionsPage();
    });

    document.getElementById("moreButton").addEventListener("click", function() {
        chrome.tabs.create({ url: "https://www.idnsl.xyz" });
    });


    document.getElementById("gotoSetting").addEventListener("click", function() {
        chrome.runtime.openOptionsPage();
    });
});