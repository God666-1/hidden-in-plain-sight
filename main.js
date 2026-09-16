const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

// NixOS: use system FFmpeg/ffprobe binaries
const ffmpegPath = 'ffmpeg'; 
const ffprobePath = 'ffprobe';

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 600,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });
    mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// 1. HANDLER: Select Video & Get Duration
ipcMain.handle('select-video', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Video',
        properties: ['openFile'],
        filters: [{ name: 'Videos', extensions: ['mp4', 'mkv', 'avi', 'mov', 'm4v'] }]
    });

    if (canceled || filePaths.length === 0) return null;
    const videoPath = filePaths[0];

    return new Promise((resolve) => {
        const ffprobe = spawn(ffprobePath, [
            '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            videoPath
        ]);
        
        let out = '';
        ffprobe.stdout.on('data', d => out += d.toString());
        
        ffprobe.on('close', () => {
            const duration = Math.floor(parseFloat(out)) || 600; 
            resolve({ path: videoPath, duration: duration });
        });
        
        ffprobe.on('error', () => resolve({ path: videoPath, duration: 600 }));
    });
});

// 2. HANDLER: Process the Video
ipcMain.handle('process-video', async (event, data) => {
    const { videoPath, images, timestamps, duration } = data;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-cipher-'));
    
    try {
        let inputArgs = ['-y', '-i', videoPath];
        let filterGraph = "";

        // Write base64 images to temporary files
        for (let i = 0; i < images.length; i++) {
            const imgPath = path.join(tmpDir, `img${i}.png`);
            const base64Data = images[i].replace(/^data:image\/png;base64,/, "");
            fs.writeFileSync(imgPath, base64Data, 'base64');
            
            inputArgs.push('-i', imgPath);

            const inBase = i === 0 ? '0:v' : `v${i}`;
            const outBase = `v${i + 1}`;
            const tStart = timestamps[i];
            const tEnd = (parseFloat(tStart) + 3).toFixed(2); // 3 seconds
            const isLast = i === images.length - 1;
            const outLabel = isLast ? 'outv' : outBase;
            
            filterGraph += `[${inBase}][${i + 1}:v]overlay=enable='between(t,${tStart},${tEnd})'[${outLabel}];`;
        }

        if (filterGraph.endsWith(';')) filterGraph = filterGraph.slice(0, -1);

        const { filePath } = await dialog.showSaveDialog(mainWindow, {
            title: 'Save Cipher Video',
            defaultPath: 'cipher_video.mp4',
            filters: [{ name: 'Movies', extensions: ['mp4'] }]
        });

        if (!filePath) {
            return { success: false, error: "Save cancelled by user." };
        }

        const args = [
            ...inputArgs,
            '-filter_complex', filterGraph,
            '-map', '[outv]',
            '-map', '0:a?', 
            '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p',
            '-preset', 'fast',
            '-c:a', 'copy',
            filePath
        ];

        return await new Promise((resolve) => {
            const ffmpegProcess = spawn(ffmpegPath, args);
            let ffmpegLogs = '';

            let lastSpeed = 'N/A';
            let lastFps = '0';

            ffmpegProcess.stderr.on('data', (data) => {
                const output = data.toString();
                ffmpegLogs += output;

                // Extract speed and fps if present in the chunk
                const speedMatch = output.match(/speed=\s*([\d.]+x|N\/A)/);
                const fpsMatch = output.match(/fps=\s*([\d.]+)/);
                if (speedMatch) lastSpeed = speedMatch[1];
                if (fpsMatch) lastFps = fpsMatch[1];

                // Extract current time and calculate progress
                const timeMatch = output.match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/);
                if (timeMatch) {
                    const timeStr = timeMatch[1];
                    const [hours, minutes, seconds] = timeStr.split(':');
                    const currentSeconds = parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseFloat(seconds);
                    const percent = Math.min((currentSeconds / duration) * 100, 100);

                    // Send progress details to UI
                    mainWindow.webContents.send('ffmpeg-progress', {
                        percent: percent,
                        speed: lastSpeed,
                        fps: lastFps,
                        time: timeStr
                    });
                }
            });

            ffmpegProcess.on('close', (code) => {
                if (code === 0) {
                    resolve({ success: true });
                } else {
                    const logLines = ffmpegLogs.trim().split('\n');
                    const lastLines = logLines.slice(-5).join('\n');
                    resolve({ 
                        success: false, 
                        error: `Exit Code ${code}. Reason:\n${lastLines}` 
                    });
                }
            });
        });

    } catch (error) {
        return { success: false, error: error.message };
    } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    }
});