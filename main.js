const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const ffmpegPath = 'ffmpeg';

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

// Listen for the processing request from the frontend
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
            const tEnd = (parseFloat(tStart) + 3).toFixed(2); // 3 seconds duration
            const isLast = i === images.length - 1;
            const outLabel = isLast ? 'outv' : outBase;
            
            filterGraph += `[${inBase}][${i + 1}:v]overlay=enable='between(t,${tStart},${tEnd})'[${outLabel}];`;
        }

        if (filterGraph.endsWith(';')) filterGraph = filterGraph.slice(0, -1);

        // Ask user where to save the final video
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
            '-preset', 'fast',  // Native CPU is fast enough to use 'fast' instead of 'ultrafast'
            '-c:a', 'copy',
            filePath
        ];

        return new Promise((resolve, reject) => {
            const ffmpegProcess = spawn(ffmpegPath, args);

            // Listen to FFmpeg stderr to calculate progress
            ffmpegProcess.stderr.on('data', (data) => {
                const output = data.toString();
                // Simple regex to extract time="hh:mm:ss"
                const timeMatch = output.match(/time=(\d{2}:\d{2}:\d{2}.\d{2})/);
                if (timeMatch) {
                    const timeStr = timeMatch[1];
                    const [hours, minutes, seconds] = timeStr.split(':');
                    const currentSeconds = parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseFloat(seconds);
                    const percent = Math.min((currentSeconds / duration) * 100, 100);
                    mainWindow.webContents.send('ffmpeg-progress', percent);
                }
            });

            ffmpegProcess.on('close', (code) => {
                if (code === 0) {
                    resolve({ success: true });
                } else {
                    resolve({ success: false, error: `FFmpeg exited with code ${code}` });
                }
            });
        });

    } catch (error) {
        return { success: false, error: error.message };
    } finally {
        // Cleanup temporary image files
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});