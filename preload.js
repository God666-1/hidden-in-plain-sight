const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    selectVideo: () => ipcRenderer.invoke('select-video'),
    processVideo: (data) => ipcRenderer.invoke('process-video', data),
    onProgress: (callback) => ipcRenderer.on('ffmpeg-progress', (event, percent) => callback(percent))
});