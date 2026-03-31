// 扫描词库文件
async function scanWordLibraries() {
  const wordLibrarySelect = document.getElementById('wordLibrary');
  wordLibrarySelect.innerHTML = '';

  // 词库文件列表
  const libraryFiles = [];

  try {
    // 默认使用word文件夹作为词库路径
    const wordPath = 'word';

    // 使用chrome.runtime.getPackageDirectoryEntry获取扩展目录
    const rootEntry = await new Promise((resolve, reject) => {
      chrome.runtime.getPackageDirectoryEntry(resolve);
    });

    // 获取词库目录
    const wordDir = await new Promise((resolve, reject) => {
      rootEntry.getDirectory(wordPath, { create: false }, resolve, reject);
    });

    // 读取词库目录下的所有文件
    const files = await new Promise((resolve, reject) => {
      const reader = wordDir.createReader();
      const entries = [];

      function readEntries() {
        reader.readEntries((results) => {
          if (results.length) {
            entries.push(...results);
            readEntries();
          } else {
            resolve(entries);
          }
        }, reject);
      }

      readEntries();
    });

    // 筛选出JSON文件
    for (const entry of files) {
      if (entry.isFile && entry.name.endsWith('.json')) {
        libraryFiles.push(entry.name);
      }
    }
  } catch (error) {
    console.error('扫描词库文件失败:', error);
    // 如果无法获取文件列表，使用CET4.json
    libraryFiles.push('CET4.json');
  }

  // 从文件名生成词库名称并添加到下拉菜单
  libraryFiles.forEach(file => {
    // 移除 .json 后缀
    const nameWithoutExt = file.replace('.json', '');
    // 生成友好的词库名称
    let friendlyName;
    if (nameWithoutExt === 'default') {
      friendlyName = '默认词库';
    } else {
      // 尝试美化文件名，例如将"CET4-顺序"转换为"CET4 顺序"
      friendlyName = nameWithoutExt.replace(/-/g, ' ');
    }

    const option = document.createElement('option');
    option.value = file;
    option.textContent = friendlyName;
    wordLibrarySelect.appendChild(option);
  });

  // 如果没有词库文件，添加默认选项
  if (wordLibrarySelect.options.length === 0) {
    const option = document.createElement('option');
    option.value = 'default.json';
    option.textContent = '默认词库';
    wordLibrarySelect.appendChild(option);
  }
}

// 加载保存的设置
async function loadSettings() {
  const data = await new Promise((resolve) => {
    chrome.storage.sync.get(['showBoth', 'playAudio', 'fadeTime', 'wordLibrary', 'audioApi', 'nextKey', 'prevKey', 'popwordEnabled'], resolve);
  });

  const enabled = data.popwordEnabled !== false; // 默认开启
  updateToggleEnabledButton(enabled);

  document.getElementById('showBoth').checked = data.showBoth || false;
  document.getElementById('playAudio').checked = data.playAudio !== false; // 默认开启
  document.getElementById('fadeTime').value = data.fadeTime || 2; // 默认2秒
  // 设置音频API，默认使用有道词典API
  document.getElementById('audioApi').value = data.audioApi || 'https://dict.youdao.com/dictvoice?type=0&audio=';
  // 设置按键，默认鼠标左键和鼠标右键
  document.getElementById('nextKey').value = data.nextKey || '鼠标左键';
  document.getElementById('prevKey').value = data.prevKey || '鼠标右键';

  // 先扫描词库
  await scanWordLibraries();

  const wordLibrarySelect = document.getElementById('wordLibrary');
  // 如果没有保存的词库选择，使用第一个可用的词库
  if (!data.wordLibrary && wordLibrarySelect.options.length > 0) {
    wordLibrarySelect.value = wordLibrarySelect.options[0].value;
  } else {
    // 设置选中的词库
    document.getElementById('wordLibrary').value = data.wordLibrary || (wordLibrarySelect.options.length > 0 ? wordLibrarySelect.options[0].value : 'CET4.json');
  }

  // 监听词库变化事件，当词库改变时重新加载音频
  wordLibrarySelect.addEventListener('change', function () {
    // 保存设置
    saveSettings();
    // 向content.js发送消息，重新加载词库和音频
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'reloadLibrary' }, function (response) {
          // 处理消息传递错误
          if (chrome.runtime.lastError) {
            console.log('消息传递失败:', chrome.runtime.lastError.message);
            return;
          }
          if (response && response.success) {
            console.log('词库已重新加载');
          }
        });
      }
    });

    // // 向所有tab的content.js发送消息，重新加载词库和音频
    // chrome.tabs.query({}, function (tabs) {
    //   tabs.forEach(tab => {
    //     chrome.tabs.sendMessage(tab.id, { action: 'reloadLibrary' }, function (response) {
    //       if (chrome.runtime.lastError) {
    //         console.log('消息传递失败:', chrome.runtime.lastError.message);
    //         return;
    //       }
    //       if (response && response.success) {
    //         console.log('词库已重新加载');
    //       }
    //     })
    //   });
    // });
  });

  // 监听音频API变化事件
  document.getElementById('audioApi').addEventListener('change', function () {
    // 保存设置
    saveSettings();
    // 向content.js发送消息，重新加载音频缓存
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'reloadLibrary' }, function (response) {
          // 处理消息传递错误
          if (chrome.runtime.lastError) {
            console.log('消息传递失败:', chrome.runtime.lastError.message);
            return;
          }
          if (response && response.success) {
            console.log('音频API已更新');
          }
        });
      }
    });
  });
}

// 更新「关闭弹词」按钮文字与样式
function updateToggleEnabledButton(enabled) {
  const btn = document.getElementById('toggleEnabledButton');
  if (!btn) return;
  if (enabled) {
    btn.textContent = '关闭弹词';
    btn.style.backgroundColor = '#607D8B';
  } else {
    btn.textContent = '开启弹词';
    btn.style.backgroundColor = '#4CAF50';
  }
}

// 保存设置
function saveSettings() {
  const showBoth = document.getElementById('showBoth').checked;
  const playAudio = document.getElementById('playAudio').checked;
  const fadeTime = parseInt(document.getElementById('fadeTime').value) || 2;
  const wordLibrary = document.getElementById('wordLibrary').value;
  const audioApi = document.getElementById('audioApi').value || 'https://dict.youdao.com/dictvoice?type=0&audio=';
  const nextKey = document.getElementById('nextKey').value || '';
  const prevKey = document.getElementById('prevKey').value || '';

  chrome.storage.sync.get(['popwordEnabled'], (prev) => {
    const popwordEnabled = prev.popwordEnabled !== false;
    chrome.storage.sync.set({ showBoth: showBoth, playAudio: playAudio, fadeTime: fadeTime, wordLibrary: wordLibrary, audioApi: audioApi, nextKey: nextKey, prevKey: prevKey, popwordEnabled: popwordEnabled }, function () {
      // 显示保存成功消息
      const statusMessage = document.getElementById('statusMessage');
      statusMessage.style.display = 'block';
      setTimeout(function () {
        statusMessage.style.display = 'none';
      }, 2000);
    });
  });
}

// 获取缓存大小
function getCacheSize() {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'getCacheSize' }, function (response) {
        // 处理消息传递错误
        if (chrome.runtime.lastError) {
          console.log('消息传递失败:', chrome.runtime.lastError.message);
          return;
        }
        if (response && response.size !== undefined) {
          const cacheInfo = document.getElementById('cacheInfo');
          cacheInfo.textContent = `当前缓存: ${response.size} 个音频`;
        }
      });
    }
  });
}

// 初始化
document.addEventListener('DOMContentLoaded', async function () {
  await loadSettings();
  // 只在点击保存按钮时保存设置
  document.getElementById('saveButton').addEventListener('click', saveSettings);

  // 关闭/开启弹词按钮
  document.getElementById('toggleEnabledButton').addEventListener('click', function () {
    chrome.storage.sync.get(['popwordEnabled'], function (data) {
      const enabled = data.popwordEnabled === false ? true : false; // 切换
      chrome.storage.sync.set({ popwordEnabled: enabled }, function () {
        updateToggleEnabledButton(enabled);
        const statusMessage = document.getElementById('statusMessage');
        statusMessage.textContent = enabled ? '弹词已开启' : '弹词已关闭';
        statusMessage.style.display = 'block';
        statusMessage.style.color = enabled ? '#4CAF50' : '#666';
        setTimeout(function () { statusMessage.style.display = 'none'; }, 1500);
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
          if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, { action: 'setEnabled', enabled: enabled });
          }
        });
      });
    });
  });

  // 点击删除缓存按钮
  document.getElementById('clearCacheButton').addEventListener('click', function () {
    // 向content.js发送消息，清除缓存并重置词库
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'clearCache' }, function (response) {
          // 处理消息传递错误
          if (chrome.runtime.lastError) {
            console.log('消息传递失败:', chrome.runtime.lastError.message);
            // 即使消息传递失败，也显示成功消息，因为我们已经清除了存储中的记录
            const statusMessage = document.getElementById('statusMessage');
            statusMessage.textContent = '缓存已删除，词库已重置';
            statusMessage.style.display = 'block';
            setTimeout(function () {
              statusMessage.style.display = 'none';
            }, 2000);
            return;
          }
          if (response && response.success) {
            // 显示成功消息
            const statusMessage = document.getElementById('statusMessage');
            statusMessage.textContent = '缓存已删除，词库已重置';
            statusMessage.style.display = 'block';
            setTimeout(function () {
              statusMessage.style.display = 'none';
            }, 2000);
            // 更新缓存大小显示
            getCacheSize();
          }
        });

        // 发送重置词库的消息
        chrome.tabs.sendMessage(tabs[0].id, { action: 'resetLibrary' }, function (response) {
          if (chrome.runtime.lastError) {
            console.log('重置词库消息传递失败:', chrome.runtime.lastError.message);
          }
        });
      }
    });

    // 获取当前词库名称
    const wordLibrary = document.getElementById('wordLibrary').value;
    const libraryName = wordLibrary.replace('.json', '');
    const storagePositionKey = `wordPosition_${libraryName}`;
    const storageHistoryKey = `wordHistory_${libraryName}`;

    // 删除Chrome存储中的所有记录
    chrome.storage.local.remove([storagePositionKey, storageHistoryKey], function () {
      console.log('删除Chrome存储中的所有记录成功');
    });
  });

  // 点击重置词库按钮
  document.getElementById('resetLibraryButton').addEventListener('click', function () {
    // 向content.js发送消息，重置词库
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'resetLibrary' }, function (response) {
          // 处理消息传递错误
          if (chrome.runtime.lastError) {
            console.log('消息传递失败:', chrome.runtime.lastError.message);
            return;
          }
          if (response && response.success) {
            // 显示成功消息
            const statusMessage = document.getElementById('statusMessage');
            statusMessage.textContent = '词库已重置';
            statusMessage.style.display = 'block';
            setTimeout(function () {
              statusMessage.style.display = 'none';
            }, 2000);
            // 更新缓存大小显示
            getCacheSize();
          }
        });
      }
    });
  });

  // 初始化时获取缓存大小
  getCacheSize();

  // 监控面板按钮点击事件
  document.getElementById('monitoringPanelButton').addEventListener('click', function () {
    document.getElementById('monitoringPanel').style.display = 'block';
    loadMonitoringData();
  });

  // 关闭监控面板按钮点击事件
  document.getElementById('closeMonitoringPanel').addEventListener('click', function () {
    document.getElementById('monitoringPanel').style.display = 'none';
  });

  // 监听存储变化，实时更新缓存大小
  chrome.storage.local.onChanged.addListener(function (changes, namespace) {
    if (changes.cacheSize) {
      const cacheInfo = document.getElementById('cacheInfo');
      cacheInfo.textContent = `当前缓存: ${changes.cacheSize.newValue} 个音频`;
    }
  });
});

// 加载监控数据
function loadMonitoringData() {
  // 获取当前词库名称
  const wordLibrary = document.getElementById('wordLibrary').value;
  const libraryName = wordLibrary.replace('.json', '');
  const storageKey = `wordHistory_${libraryName}`;

  // 从Chrome存储中获取历史记录
  chrome.storage.local.get([storageKey], function (result) {
    const history = result[storageKey] || [];

    if (history.length === 0) {
      document.getElementById('monitoringContent').innerHTML = '<p style="text-align: center; color: #666;">暂无历史记录</p>';
      return;
    }

    // 按日期分类历史记录
    const historyByDate = {};
    history.forEach(record => {
      // 验证日期格式是否有效
      const dateObj = new Date(record.date);
      let date;
      if (isNaN(dateObj.getTime())) {
        // 无效日期，使用当前日期作为默认值
        date = new Date().toLocaleDateString();
      } else {
        date = dateObj.toLocaleDateString();
      }
      if (!historyByDate[date]) {
        historyByDate[date] = [];
      }
      historyByDate[date].push(record);
    });

    // 按日期降序排序
    const sortedDates = Object.keys(historyByDate).sort((a, b) => {
      // 转换为日期对象进行比较，确保正确排序
      return new Date(b) - new Date(a);
    });

    // 生成监控面板内容
    let content = '';
    sortedDates.forEach(date => {
      const records = historyByDate[date];
      content += `
        <div class="date-group">
          <div class="date-header" style="cursor: pointer; padding: 8px; background-color: #e3f2fd; border-radius: 4px; margin-bottom: 5px; display: flex; justify-content: space-between; align-items: center;">
            <span style="font-weight: bold;">${date}</span>
            <span class="toggle-icon" style="font-size: 12px;">▼</span>
          </div>
          <div class="date-content" style="padding-left: 15px; display: block;">
            ${records.map(record => {
        // 处理不同结构的记录
        let type = '无词性';
        let meaning = '无释义';
        if (record.translations && record.translations.length > 0) {
          // 完整的单词对象，从translations中获取
          type = record.translations[0].type || '无词性';
          meaning = record.translations[0].translation || '无释义';
        } else {
          // 简化的记录，直接使用type和meaning属性
          type = record.type || '无词性';
          meaning = record.meaning || '无释义';
        }
        return `
                <div style="margin-bottom: 5px; padding: 5px; background-color: #fff; border-radius: 3px; border-left: 3px solid #2196F3; cursor: pointer; transition: background-color 0.2s;">
                  <div><strong style="color: #2196F3;">${record.word}</strong> (${type})</div>
                  <div style="font-size: 12px; color: #666;">${meaning}</div>
                </div>
              `;
      }).join('')}
          </div>
        </div>
      `;
    });

    document.getElementById('monitoringContent').innerHTML = content;

    // 添加日期行点击事件，实现收起/展开功能
    document.querySelectorAll('.date-header').forEach(header => {
      header.addEventListener('click', function () {
        const content = this.nextElementSibling;
        const icon = this.querySelector('.toggle-icon');
        if (content.style.display === 'none') {
          content.style.display = 'block';
          icon.textContent = '▼';
        } else {
          content.style.display = 'none';
          icon.textContent = '▶';
        }
      });
    });

    // 添加单词点击事件，播放音频
    document.querySelectorAll('.date-content > div').forEach((wordElement, index) => {
      wordElement.addEventListener('click', function () {
        // 更改背景颜色以提供反馈
        this.style.backgroundColor = '#f0f8ff';
        setTimeout(() => {
          this.style.backgroundColor = '#fff';
        }, 200);

        // 获取单词
        const wordText = this.querySelector('strong').textContent;
        console.log('播放单词音频:', wordText);

        // 从设置中获取音频API
        const audioApi = document.getElementById('audioApi').value || 'https://dict.youdao.com/dictvoice?type=0&audio=';
        // 构建音频URL
        const audioUrl = audioApi + encodeURIComponent(wordText);
        console.log('构建的音频URL:', audioUrl);

        // 播放音频
        const audio = new Audio(audioUrl);
        audio.play().then(() => {
          console.log('音频播放成功:', wordText);
        }).catch(error => {
          console.error('播放音频失败:', error);
          // 失败时尝试使用Web Speech API
          if ('speechSynthesis' in window) {
            try {
              const speech = new SpeechSynthesisUtterance(wordText);
              speech.lang = 'en-US';
              speech.rate = 1.0;
              speech.pitch = 1.0;
              speech.volume = 1.0;
              window.speechSynthesis.speak(speech);
              console.log('Web Speech API播放成功:', wordText);
            } catch (error) {
              console.error('Web Speech API播放失败:', error);
            }
          }
        });
      });
    });
  });
}