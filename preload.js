const fs = require('fs')
const path = require('path')
const { contextBridge } = require('electron');

// 默认设置
const DEFAULT_SETTINGS = {
    snippetsPath: '', // 旧版单一路径（保持向后兼容）
    snippetsPaths: [], // 新版多路径支持
    autoInsert: true, // 是否自动插入内容
    searchSubfolders: true, // 是否搜索子文件夹
};

// 用于存储所有文本片段的缓存
let snippetsCache = [];

// 直接插入功能的主要实现
function insertContent(content, insertMode = 'plain') {
    console.log('准备插入内容:', content.substring(0, 30) + '...');
    
    try {
        // 1. 隐藏uTools窗口
        utools.hideMainWindow();
        console.log('窗口已隐藏');
        
        if (insertMode === 'plain') {
            utools.copyText(content);
            utools.simulateKeyboardTap('v', 'ctrl');
        } else if (insertMode === 'markdown') {
            // 添加markdown格式的特殊处理
            let formattedContent = content;
            // 检查是否需要添加markdown语法
            if (!/^#|^\*\*|^>\s|^```|^\-\s|^\d+\.\s/.test(content)) {
                // 如果内容不包含markdown语法，自动添加一些基本格式
                if (content.split('\n').length > 1) {
                    // 多行内容，添加代码块
                    formattedContent = '```\n' + content + '\n```';
                }
            }
            utools.copyText(formattedContent);
            utools.simulateKeyboardTap('v', 'ctrl');
        } else {
            utools.copyText(content);
            utools.simulateKeyboardTap('v', 'ctrl');
        }
        
        // 3. 在隐藏窗口后延时执行，确保界面退出
        setTimeout(() => {
            try {
                // 4. 模拟Ctrl+V粘贴操作
                console.log('执行粘贴操作');
                utools.simulateKeyboardTap('v', 'ctrl');
                
                // 5. 粘贴后退出插件
                setTimeout(() => {
                    console.log('操作完成，退出插件');
                    utools.outPlugin();
                }, 250);
            } catch (err) {
                console.error('粘贴操作失败:', err);
                utools.showNotification('粘贴失败: ' + err.message);
                utools.outPlugin();
            }
        }, 150);
    } catch (error) {
        console.error('插入过程中发生错误:', error);
        utools.showNotification('操作失败: ' + error.message);
        utools.outPlugin();
    }
}

// 扫描文件夹
function scanFolder() {
    console.log('开始扫描文件夹...');
    
    const settings = getSettings();
    const allSnippets = [];
    
    // 获取所有路径
    const paths = Array.isArray(settings.snippetsPaths) && settings.snippetsPaths.length > 0 
        ? settings.snippetsPaths 
        : (settings.snippetsPath ? [settings.snippetsPath] : []);
    
    if (paths.length === 0) {
        console.log('未设置有效的片段路径');
        snippetsCache = [];
        return [];
    }
    
    try {
        // 递归扫描函数
        function readDir(dir, subDir = false) {
            if (!dir || !fs.existsSync(dir)) {
                console.log(`路径不存在: ${dir}`);
                return;
            }
            
            if (!settings.searchSubfolders && subDir) {
                // 如果设置不搜索子文件夹，并且当前是子文件夹，则跳过
                return;
            }
            
            const items = fs.readdirSync(dir);
            
            for (const item of items) {
                const fullPath = path.join(dir, item);
                const stat = fs.statSync(fullPath);
                
                if (stat.isFile() && path.extname(item).toLowerCase() === '.md') {
                    try {
                        const content = fs.readFileSync(fullPath, 'utf8');
                        const fileName = path.basename(item, '.md');
                        
                        allSnippets.push({
                            fileName,
                            title: fileName,
                            path: fullPath,
                            content,
                            preview: content.slice(0, 200) + (content.length > 200 ? '...' : '')
                        });
                    } catch (error) {
                        console.error(`读取文件 ${fullPath} 失败:`, error);
                    }
                } else if (stat.isDirectory() && settings.searchSubfolders) {
                    readDir(fullPath, true);
                }
            }
        }
        
        // 扫描每个路径
        for (const folderPath of paths) {
            if (folderPath && fs.existsSync(folderPath)) {
                console.log(`扫描路径: ${folderPath}`);
                readDir(folderPath);
            } else {
                console.log(`跳过无效路径: ${folderPath}`);
            }
        }
        
        console.log(`共找到 ${allSnippets.length} 个片段`);
        
        snippetsCache = allSnippets;
        
        // 注册动态命令
        registerDynamicCommands(allSnippets);
        
        return allSnippets;
    } catch (error) {
        console.error('扫描文件夹失败:', error);
        return [];
    }
}

// 注册动态命令
function registerDynamicCommands(snippets) {
    console.log('开始注册动态命令...');
    
    // 清理旧特性
    try {
        const features = utools.getFeatures();
        console.log('当前特性列表:', features.map(f => f.code));
        
        for (const feature of features) {
            // 清理以snippet-开头的动态特性
            if (feature.code.startsWith('snippet-')) {
                console.log(`移除特性: ${feature.code}`);
                utools.removeFeature(feature.code);
            }
        }
        console.log('旧特性清理完成');
    } catch (error) {
        console.error('清理旧特性失败:', error);
    }
    
    // 定义和注册新特性
    const dynamicFeatures = [];
    
    // 为每个片段创建一个特性
    snippets.forEach(snippet => {
        try {
            const featureCode = `snippet-${snippet.fileName}`;
            
            // 准备特性定义
            const feature = {
                code: featureCode,
                explain: `插入文本: ${snippet.fileName}`,
                cmds: [snippet.fileName],
                // 使用none模式直接执行
                mode: 'none'
            };
            
            dynamicFeatures.push(feature);
        } catch (err) {
            console.error(`创建特性 ${snippet.fileName} 失败:`, err);
        }
    });
    
    // 批量注册特性
    if (dynamicFeatures.length > 0) {
        try {
            console.log(`尝试注册 ${dynamicFeatures.length} 个动态特性`);
            utools.setFeature(dynamicFeatures);
            console.log('批量特性注册成功');
        } catch (error) {
            console.error('批量注册特性失败:', error);
            
            // 如果批量注册失败，尝试单个注册
            dynamicFeatures.forEach(feature => {
                try {
                    utools.setFeature(feature);
                    console.log(`单独注册特性成功: ${feature.code}`);
                } catch (err) {
                    console.error(`单独注册特性失败: ${feature.code}`, err);
                }
            });
        }
    }
    
    console.log(`动态命令注册完成，共 ${dynamicFeatures.length} 个`);
}

// 获取设置
function getSettings() {
    try {
        return utools.dbStorage.getItem('snippets-settings') || DEFAULT_SETTINGS;
        } catch (error) {
            console.error('获取设置失败:', error);
            return DEFAULT_SETTINGS;
        }
}

    // 保存设置
function saveSettings(settings) {
        try {
        utools.dbStorage.setItem('snippets-settings', settings);
            return true;
        } catch (error) {
            console.error('保存设置失败:', error);
            return false;
        }
}

// 处理动态特性的调用
function handleDynamicFeature(code) {
    if (code.startsWith('snippet-')) {
        const fileName = code.replace('snippet-', '');
        console.log(`处理动态特性: ${fileName}`);
        
        // 查找对应的片段
        const snippet = snippetsCache.find(s => s.fileName === fileName);
        if (snippet) {
            insertContent(snippet.content);
            return true;
        } else {
            console.error(`找不到对应的片段: ${fileName}`);
            utools.showNotification(`找不到片段: ${fileName}`);
            return false;
        }
    }
    return false;
}

// 创建片段时获取第一个有效路径
function getFirstValidPath(settings) {
    // 先从 snippetsPaths 中获取第一个有效路径
    if (Array.isArray(settings.snippetsPaths) && settings.snippetsPaths.length > 0) {
        for (const path of settings.snippetsPaths) {
            if (path && fs.existsSync(path)) {
                return path;
            }
        }
    }
    
    // 如果没有，则尝试使用 snippetsPath
    if (settings.snippetsPath && fs.existsSync(settings.snippetsPath)) {
        return settings.snippetsPath;
    }
    
    return null;
}

// 获取默认存储路径
function getDefaultSnippetsPath(settings) {
    // 首先使用指定的默认路径
    if (settings.defaultSnippetsPath && fs.existsSync(settings.defaultSnippetsPath)) {
        return settings.defaultSnippetsPath;
    }
    
    // 如果未指定默认路径或路径无效，则使用第一个有效路径
    return getFirstValidPath(settings);
}

// 导出主要功能
window.exports = {
    // 浏览和管理文本片段
    "text-snippets": {
        mode: "list",
        args: {
            enter: (action, callbackSetList) => {
                // 刷新扫描
                const snippets = scanFolder();
                
                // 显示所有片段
                callbackSetList(snippets.map(snippet => ({
                    title: snippet.title,
                    description: snippet.preview,
                    icon: 'file-text.png',
                    data: snippet
                })));
            },
            search: (action, searchWord, callbackSetList) => {
                if (!searchWord) {
                    return callbackSetList(snippetsCache.map(snippet => ({
                        title: snippet.title,
                        description: snippet.preview,
                        icon: 'file-text.png',
                        data: snippet
                    })));
                }
                
                // 搜索匹配的片段
                const results = snippetsCache.filter(snippet => 
                    snippet.title.toLowerCase().includes(searchWord.toLowerCase()) ||
                    snippet.content.toLowerCase().includes(searchWord.toLowerCase())
                );
                
                callbackSetList(results.map(snippet => ({
                    title: snippet.title,
                    description: snippet.preview,
                    icon: 'file-text.png',
                    data: snippet
                })));
            },
            select: (action, itemData) => {
                // 当选择某一项时，插入内容
                insertContent(itemData.content);
            }
        }
    },
    
    // 设置界面
    "settings": {
        mode: "none",
        args: {
            enter: (action) => {
                utools.setExpendHeight(450);
            }
        }
    }
};

// 服务提供给渲染进程
window.services = {
    getSettings: () => getSettings(),
    
    saveSettings: (settings) => {
        const result = saveSettings(settings);
        if (result) {
            // 如果设置变更成功，重新扫描
            scanFolder();
        }
        return result;
    },
    
    selectFolder: () => {
        const result = utools.showOpenDialog({
            title: '选择文本片段文件夹',
            properties: ['openDirectory']
        });
        return result ? result[0] : null;
    },

    getSnippets: () => snippetsCache,
    
    refreshSnippets: () => {
        return scanFolder();
    },
    
    createSnippet: (title, content) => {
        try {
            const settings = getSettings();
            // 使用默认路径，而不是第一个路径
            const snippetsPath = getDefaultSnippetsPath(settings);
            
            if (!snippetsPath) {
                throw new Error('未设置有效的文本片段文件夹路径');
            }
            
            // 确保文件名有效
            const safeTitle = title.replace(/[\\/:*?"<>|]/g, '_');
            const filePath = path.join(snippetsPath, `${safeTitle}.md`);
            
            // 写入文件
            fs.writeFileSync(filePath, content, 'utf8');
            
            // 更新缓存
            scanFolder();
            
            return true;
        } catch (error) {
            console.error('创建片段失败:', error);
            return false;
        }
    },
    
    deleteSnippet: (fileName) => {
        try {
            const snippet = snippetsCache.find(s => s.fileName === fileName);
            if (!snippet) {
                throw new Error('找不到对应的片段');
            }
            
            // 删除文件
            fs.unlinkSync(snippet.path);
            
            // 更新缓存
            scanFolder();
            
            return true;
        } catch (error) {
            console.error('删除片段失败:', error);
            return false;
        }
    },
    
    editSnippet: (fileName, newContent) => {
        try {
            const snippet = snippetsCache.find(s => s.fileName === fileName);
            if (!snippet) {
                throw new Error('找不到对应的片段');
            }
            
            // 更新文件内容
            fs.writeFileSync(snippet.path, newContent, 'utf8');
            
            // 更新缓存
            scanFolder();
            
            return true;
        } catch (error) {
            console.error('编辑片段失败:', error);
            return false;
        }
    }
};

// 初始化插件
(function init() {
    console.log('插件初始化中...');
    
    // 添加插件进入事件监听
    utools.onPluginEnter(({ code, type, payload }) => {
        console.log(`插件进入 - code: ${code}, type: ${type}`);
        
        if (code === 'settings') {
            // 设置界面
            utools.setExpendHeight(450);
        } else if (code.startsWith('snippet-')) {
            // 动态命令处理
            handleDynamicFeature(code);
        } else if (code === 'text-snippets') {
            // 主界面，由window.exports处理
            console.log('进入主界面');
        }
    });
    
    // 添加插件特性处理事件
    utools.onPluginReady(() => {
        console.log('插件准备就绪');
        
        // 初始化扫描
        scanFolder();
    });
    
    // 设置定时扫描 - 每分钟检查一次更新
    setInterval(() => {
        console.log('执行定时扫描...');
        scanFolder();
    }, 60000);
    
    console.log('插件初始化完成');
})(); 