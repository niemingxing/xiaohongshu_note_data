let currentDomain = window.location.hostname;
let currentUrl = window.location.href;
let downloadData = [];
/**
 * 保存内容为csv文件
 * @param csvContent
 */
function downloadCsv(csvContent)
{
	// 创建一个 Blob 对象，将内容保存为 CSV 文件
	var blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });

	// 生成一个临时下载链接并下载文件
	var link = document.createElement("a");
	link.href = URL.createObjectURL(blob);
	link.download = "data(" + currentDomain+ ").csv";
	link.click();
}

/**
 * 初始化弹层
 */
function initDownloadButton() {
	const html = '<div class="gpt-sr-container">\n' +
		'    <div class="gpt-sr-sidebar">\n' +
		'      <button id="gpt-sr-toggleButton">笔记下载</button>\n' +
		'    </div>\n' +
		'  </div>\n' +
		'  \n' +
		'  <div id="gpt-sr-popup" class="gpt-sr-popup">\n' +
		'    <button class="gpt-sr-close-btn">&times;</button>\n' +
		'	 <button class="gpt-sr-starting-btn">开始执行</button>\n' +
		'    <div class="gpt-sr-content">\n' +
		'      <h2 class="gpt-sr-title">关键词列表</h2>\n' +
		'      <ul class="gpt-sr-list">\n' +
		'      </ul>\n' +
		'    </div>\n' +
		'  </div>';
	const popupElement = document.createElement("div");
	popupElement.innerHTML = html;
	document.body.appendChild(popupElement);
	document.querySelector("#gpt-sr-toggleButton").addEventListener("click", function() {
		this.disabled = true;
		chrome.runtime.sendMessage({"type":"check_mkey"}, function (response) {
			console.log(response.farewell)
		});
	});
}

function activiteDownloadButton()
{
	document.querySelector("#gpt-sr-toggleButton").disabled = false;
}

function initOtherActon()
{
	let pageType = getPageType();
	if(pageType == "search_result")
	{
		setInterval(function (){
			updateDownloadButtonVideoCount();
			getSearchVideoData();
		},1500);
	}
}

/**
 * 初始化提示窗
 */
function initPromptMessagePopup()
{
	let html = "<div id=\"nmx_video_popup\" class=\"custom-popup\">\n" +
		"\t\t<div class=\"custom-popup-overlay\"></div>\n" +
		"\t\t<div class=\"custom-popup-content\">\n" +
		"\t\t\t<span id=\"nmx_video_popup_message\" class=\"custom-popup-question\"></span>\n" +
		"\t\t\t<button id=\"nmx_video_close_popupbtn\" class=\"custom-popup-close-btn\">确认</button>\n" +
		"\t\t</div>\n" +
		"\t</div>";
	const popupElement = document.createElement("div");
	popupElement.innerHTML = html;
	document.body.appendChild(popupElement);
	// 获取弹窗元素
	const popup = document.getElementById('nmx_video_popup');
	// 获取关闭按钮元素
	const closeButton = document.getElementById('nmx_video_close_popupbtn');

	// 点击关闭按钮关闭弹窗
	closeButton.addEventListener('click', function (){
		popup.style.display = 'none';
	});
}

// 显示弹窗并设置错误提示文字
function showPromptMessagePopup(message,type =1) {
	// 获取弹窗元素
	const popup = document.getElementById('nmx_video_popup');
	// 获取错误提示元素
	const errorText = document.getElementById('nmx_video_popup_message');
	errorText.textContent = message;
	popup.style.display = 'block';
	if(type == 2)
	{
		// 获取关闭按钮元素
		const closeButton = document.getElementById('nmx_video_close_popupbtn');
		closeButton.style.display = 'none';
		setTimeout(function (){
			closeButton.click();
		},3000);
	}
}

/**
 * 引入css文件
 * @param url
 */
function addStylesheet(url) {
	const linkElement = document.createElement("link");
	linkElement.rel = "stylesheet";
	linkElement.type = "text/css";
	linkElement.href = chrome.runtime.getURL(url);
	document.head.appendChild(linkElement);
}

/**
 * 开始下载
 */
function startDownload()
{
	let pageType = getPageType();
	if(pageType == "search_result")
	{
		startVideoListDataDownload();
	}
}

/**
 * 视频数据下载
 */
function startVideoListDataDownload()
{
	let videoListData = downloadData;
	let header = [];
	let keys = []
	let pageType = getPageType();
	if(pageType == "search_result")
	{
		header = ["博主名","博主地址","笔记标题","笔记地址","点赞","点赞数"];
		keys = ["author","author_url","title","url","like_text","like_nums"];
	}
	let csvContent = convertToCSVContent(videoListData,header,keys);
	downloadCsv(csvContent);
}

/**
 * 获取页面类型
 * @returns {string}
 */
function getPageType()
{
	currentUrl = window.location.href;
	let pageType;
	if(currentUrl.includes("https://www.xiaohongshu.com/search_result/"))
	{
		pageType = "search_result";
	}
	console.log(pageType);
	return pageType;
}

/**
 * 更新按钮统计文案
 */
function updateDownloadButtonVideoCount()
{
	let buttonElement = document.querySelector("#gpt-sr-toggleButton");
	let videoNums = getSearchVideoCount();
	buttonElement.textContent = "笔记下载(" + videoNums + ")";
}

/**
 * 获取搜索页视频数量
 * @returns {number}
 */
function getSearchVideoCount()
{
	return downloadData.length;
}

/**
 * 获取搜索页视频数据
 * @returns {*[]}
 */
function getSearchVideoData()
{
	let pageType;
	let items;
	pageType = getPageType();
	if(pageType == "search_result") {
		items = document.querySelectorAll("div.feeds-container section");
		console.log(items.length);
		items.forEach((node) => {
			// 操作每个节点的代码
			let authorItem = node.querySelector("a.author");
			let titleItem = node.querySelector("a.title");
			let likeItem = node.querySelector("span.like-wrapper span.count");
			if(authorItem)
			{
				let author = authorItem.innerText;
				let userUrl = authorItem.href;
				let title = titleItem.innerText;
				let url = titleItem.href;
				let likeText = likeItem.innerText;
				let likeNums = convertToNumber(likeText);

				let dataItem = {
					"author": author,
					"author_url": userUrl,
					"title": title,
					"url": url,
					"like_text": likeText,
					"like_nums": likeNums,
				};
				console.log(title);
				addUniqueData(downloadData,dataItem,'url');
			}

		});
	}
	//console.log(downloadData);
	return downloadData;
}

function addUniqueData(arr, newData,key) {
	if (!arr.some(item => item[key] === newData[key])) {
		arr.push(newData);
	}
}


/**
 * 点赞量转数字
 * @param str
 * @returns {number|number}
 */
function convertToNumber(str) {
	const match = str.match(/(\d+(\.\d+)?)/);
	if (match) {
		const num = parseFloat(match[1]);
		if(str.includes("w"))
		{
			return num * 10000;
		}
		return num;
	}
	return str;
}

/**
 * 格式化csv内容特殊字符
 * @param value
 * @returns {string}
 */
function formatCSVValue(value) {
	if (typeof value === 'string') {
		if (/[",\n\t]/.test(value)) {
			value = value.replace(/"/g, '""');
			value = `"${value}"`;
		}
	}
	return value;
}

/**
 * 把数组转换成csv内容
 * @param data
 * @returns {string}
 */
function convertToCSVContent(data,header=[],keysArr = []) {
	let pHeader = header.length == 0 ? ["作者", "标题", "点赞文本", "点赞数量", "视频地址", "日期"] : header;
	let pKeysArr = keysArr.length ==0 ? ["auther", "title", "like_text", "like_nums", "video_url", "date_str"] : keysArr;
	const rows = data.map(row => pKeysArr.map(key => formatCSVValue(row[key])).join(","));
	return [pHeader.join(",")].concat(rows).join("\n");
}

/**
 * 微信号提取
 * @param text
 * @returns {null|*}
 */
function extractWeChatIds(text) {
	const regex = /[\w\-+.]{6,20}/g; // 贪婪匹配，匹配包含字母、数字、下划线、连字符、加号和点号的字符序列
	const matches = text.match(regex);
	if (matches && matches.length > 0) {
		return matches.join("、");
	}
	return null; // 未找到微信号
}



// 在页面加载完成后插入弹层和引入CSS文件
window.onload = function() {
	if(currentDomain.includes("www.xiaohongshu.com"))
	{
		initPromptMessagePopup();
		initDownloadButton();
		initOtherActon();
		addStylesheet("css/page_layer.css");
	}
};
/**
 * 事件监听
 */
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
	window.focus();
	console.log(message.type);
	if(message.type == 'check_mkey_complete')
	{
		activiteDownloadButton();
		if(message.data.hasOwnProperty("code") && message.data.code !=0)
		{
			showPromptMessagePopup(message.data.message);
		}
		else
		{
			startDownload();
		}
	}
});
