// options.js
document.addEventListener('DOMContentLoaded', function() {
    var mKeyInput = document.getElementById('mKey');
    var downLoadNumsInput= document.getElementById('downLoadNums');
    var appIdInput = document.getElementById('appId');
    var appSecretInput= document.getElementById('appSecret');
    var appTokenInput= document.getElementById('appToken');
    var tableIdInput = document.getElementById('tableId');
    var saveButton = document.getElementById('saveButton');

    // 获取保存的密钥值并设置输入框的默认值
    chrome.storage.local.get('nmx_xhs_setting', function(result) {
        let setting = result.nmx_xhs_setting;
        if (setting) {
            mKeyInput.value = setting.mkey;
            downLoadNumsInput.value = setting.download_nums;
            appIdInput.value = setting.app_id ?? '';
            appSecretInput.value = setting.app_secret ?? '';
            appTokenInput.value = setting.app_token ?? '';
            tableIdInput.value = setting.table_id ?? '';
            console.log(setting);
        }
    });

    // 保存按钮点击事件处理程序
    saveButton.addEventListener('click', function() {
        let setting = {
            'mkey':  mKeyInput.value,
            'download_nums' : downLoadNumsInput.value,
            'app_id': appIdInput.value,
            'app_secret': appSecretInput.value,
            'app_token': appTokenInput.value,
            'table_id': tableIdInput.value
        };
        chrome.storage.local.set({ 'nmx_xhs_setting': setting }, function() {
            alert('设置已保存');
        });
    });
});
