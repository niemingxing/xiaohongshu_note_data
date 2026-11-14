let mKey = '';

// 点击工具栏图标时打开侧边栏
chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.log('setPanelBehavior error:', error));

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
        if(request.type == 'check_mkey')
        {
            // 侧边栏导出 Excel 前校验密钥，直接把结果回传给侧边栏
            initSetting(function (){
                checkMKey(function (data){
                    sendResponse(data);
                });
            });
            return true; // 表示将发送异步响应
        }else if(request.type == 'get_note_state')
        {
            // content-script 运行在隔离环境读不到页面变量，这里到页面主环境读取 __INITIAL_STATE__ 中的笔记封面
            chrome.scripting.executeScript({
                target: { tabId: sender.tab.id },
                world: 'MAIN',
                args: [request.noteId],
                func: (noteId) => {
                    try {
                        const note = window.__INITIAL_STATE__.note.noteDetailMap[noteId].note;
                        const image = (note.imageList || [])[0] || {};
                        return { cover: image.urlDefault || image.urlPre || '' };
                    } catch (e) {
                        return null;
                    }
                }
            }).then((results) => sendResponse(results && results[0] ? results[0].result : null))
              .catch(() => sendResponse(null));
            return true; // 表示将发送异步响应
        }else if (request.action === "proxyRequest") {
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
        }else if(request.type == 'download_single_note')
            {
                initSetting(function (){
                    checkMKey(function (data){
                        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
                            chrome.tabs.sendMessage(tabs[0].id, {'data':data,type:'download_single_note'});
                        });
                    });
                });
                sendResponse({ farewell: "Background runtime onMessage!" });
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
        if(callback) callback();
    });
}
