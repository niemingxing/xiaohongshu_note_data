let mKey = '';
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
        console.log(request.type);
        if(request.type == 'check_mkey')
        {
            initSetting(function (){
                checkMKey(function (data){
                    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
                        chrome.tabs.sendMessage(tabs[0].id, {'data':data,type:'check_mkey_complete'});
                    });
                });
            });
            sendResponse({ farewell: "Background runtime onMessage!" });
        }
        else if (request.action === "proxyRequest") {
            (async () => {
                try {
                  const response = await fetch(request.url, {
                    method: request.method,
                    headers: request.headers,
                    body: request.body,
                    credentials: 'include'  // 确保携带 Cookie
                  });
                  const data = await response.text();
                  sendResponse({status: 'success', data: data});
                } catch (error) {
                  sendResponse({status: 'error', message: error.message});
                }
              })();
              return true; // 表示将发送异步响应
        }
    }
);

/**
 * 检查mkey合法性
 */
function checkMKey(callback)
{
    if(mKey == '')
    {
        if(callback) callback({"code":"1002",'message':"没有配置密钥,请点击插件右上角设置！"});
        return;
    }
    fetch('https://api.kaipm.com/code/check_mkey',{
        method: 'POST',
        headers: {
            'Accept': 'application/json, */*',
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'cache': 'default',
            'x-ajax': 'true'
        },
        'credentials': 'include', //表示请求是否携带cookie
        body: "mkey=" + mKey
    })
        // fetch()接收到的response是一个 Stream 对象
        // response.json()是一个异步操作，取出所有内容，并将其转为 JSON 对象
        .then(response => response.json())
        .then(json => {
            console.log(json);
            if(callback) callback(json);
        })
        .catch(err => {
            console.log('Request Failed', err);
            if(callback) callback({"code":"1001",'message':"网络请求异常,密钥验证走外网域名,可以科学试下!"});
        });
}

function initSetting(callback)
{
    // 获取存储的值
    chrome.storage.local.get('nmx_xhs_setting', function (data) {
        mKey = (data.hasOwnProperty("nmx_xhs_setting") && data.nmx_xhs_setting.hasOwnProperty("mkey")) ? data.nmx_xhs_setting.mkey : '';
        // 在这里使用存储的值
        console.log(mKey);
        if(callback) callback();
    });
}
