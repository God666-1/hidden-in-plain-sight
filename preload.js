const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    processVideo: (data) => ipcRenderer.invoke('process-video', data),
    onProgress: (callback) => ipcRenderer.on('ffmpeg-progress', (event, percent) => callback(percent))
});