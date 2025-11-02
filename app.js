/**
 * HistogramHelper Class
 */
class HistogramHelper {
    static analyze(imageData) {
        const data = imageData.data;
        const rHist = new Uint32Array(256).fill(0); const gHist = new Uint32Array(256).fill(0); const bHist = new Uint32Array(256).fill(0);
        for (let i = 0; i < data.length; i += 4) { rHist[data[i]]++; gHist[data[i+1]]++; bHist[data[i+2]]++; }
        return { rHist, gHist, bHist };
    }
    static draw(canvas, histData, gridColor) {
        const { rHist, gHist, bHist } = histData; const ctx = canvas.getContext('2d');
        const width = canvas.width; const height = canvas.height;
        ctx.clearRect(0, 0, width, height);
        ctx.strokeStyle = gridColor;
        ctx.fillStyle = gridColor;
        ctx.font = "12px Arial";
        ctx.beginPath();
        const gridLines = 5;
        for (let i = 1; i <= gridLines; i++) {
            const y = height * (i / gridLines);
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
        }
        ctx.globalAlpha = 0.2;
        ctx.stroke();
        ctx.globalAlpha = 1.0;
        let max = 0;
        for (let i = 0; i < 256; i++) {
            if (rHist[i] > max) max = rHist[i]; if (gHist[i] > max) max = gHist[i]; if (bHist[i] > max) max = bHist[i];
        }
        ctx.fillText("0", 5, height - 5);
        ctx.fillText("128", width / 2 - 10, height - 5);
        ctx.fillText("255", width - 25, height - 5);
        ctx.fillText(max, 5, 15);
        const barWidth = width / 256;
        this.drawChannel(ctx, rHist, max, height, barWidth, 'rgba(255, 0, 0, 0.7)');
        this.drawChannel(ctx, gHist, max, height, barWidth, 'rgba(0, 255, 0, 0.7)');
        this.drawChannel(ctx, bHist, max, height, barWidth, 'rgba(0, 0, 255, 0.7)');
    }
    static drawChannel(ctx, hist, max, height, barWidth, color) {
        ctx.fillStyle = color;
        for (let i = 0; i < 256; i++) {
            const barHeight = (hist[i] / max) * height;
            ctx.fillRect(i * barWidth, height - barHeight, barWidth, barHeight);
        }
    }
}

/**
 * WavHelper Class
 * (Patched with v10 fixes for offset errors)
 */
class WavHelper {
    static readString(view, offset, length) { let s = ''; for (let i = 0; i < length; i++) s += String.fromCharCode(view.getUint8(offset + i)); return s; }
    static writeString(view, offset, str) { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); }
    
    static parse(arrayBuffer) {
        const view = new DataView(arrayBuffer);
        if (this.readString(view, 0, 4) !== 'RIFF') throw new Error('Invalid WAV file: Missing RIFF header.');
        if (this.readString(view, 8, 4) !== 'WAVE') throw new Error('Invalid WAV file: Missing WAVE format.');
        
        let offset = 12, fmtChunk = null, dataChunk = null, headerChunks = [];
        
        while (offset + 8 <= view.byteLength) { 
            const chunkId = this.readString(view, offset, 4);
            let chunkSize = view.getUint32(offset + 4, true);
            const chunkDataOffset = offset + 8;
            
            let jumpSize = 8 + chunkSize;
            if (chunkSize % 2 !== 0) {
                jumpSize++;
            }
            
            if (offset + jumpSize > view.byteLength && chunkDataOffset + chunkSize > view.byteLength) {
                 console.warn(`WAV chunk '${chunkId}' is corrupt (size: ${chunkSize} @ offset: ${offset}). File may be truncated.`);
                break; 
            }

            if (chunkId === 'fmt ') {
                fmtChunk = {
                    audioFormat: view.getUint16(chunkDataOffset, true), numChannels: view.getUint16(chunkDataOffset + 2, true),
                    sampleRate: view.getUint32(chunkDataOffset + 4, true), byteRate: view.getUint32(chunkDataOffset + 8, true),
                    blockAlign: view.getUint16(chunkDataOffset + 12, true), bitsPerSample: view.getUint16(chunkDataOffset + 14, true),
                };
                headerChunks.push(arrayBuffer.slice(offset, offset + jumpSize)); 
            } else if (chunkId === 'data') {
                if (chunkDataOffset + chunkSize > view.byteLength) {
                    throw new Error("Corrupt WAV: 'data' chunk size exceeds file length.");
                }
                dataChunk = { offset: chunkDataOffset, size: chunkSize };
            } else { 
                headerChunks.push(arrayBuffer.slice(offset, offset + jumpSize)); 
            }
            offset += jumpSize; 
        }
        
        if (!fmtChunk) throw new Error('Invalid WAV file: Missing "fmt " chunk.');
        if (!dataChunk) throw new Error('Invalid WAV file: Missing "data" chunk.');
        
        // **THE FINAL FIX**
        if (dataChunk.offset + dataChunk.size > arrayBuffer.byteLength) {
            throw new Error("Corrupt WAV: 'data' chunk data is out of bounds.");
        }

        let samples;
        if (fmtChunk.bitsPerSample === 8) samples = new Uint8Array(arrayBuffer, dataChunk.offset, dataChunk.size);
        else if (fmtChunk.bitsPerSample === 16) samples = new Int16Array(arrayBuffer, dataChunk.offset, dataChunk.size / 2);
        else throw new Error(`Unsupported bit depth: ${fmtChunk.bitsPerSample}.`);
        
        return { fmtChunk, headerChunks, samples };
    }

    static build(fmtChunk, headerChunks, modifiedSamples) {
        const sampleSize = modifiedSamples.byteLength; let headerSize = 0;
        for (const chunk of headerChunks) headerSize += chunk.byteLength;
        
        let dataChunkSize = sampleSize;
        if (dataChunkSize % 2 !== 0) {
            dataChunkSize++;
        }
        
        const fileSize = 4 + headerSize + 8 + dataChunkSize;
        const buffer = new ArrayBuffer(8 + fileSize); const view = new DataView(buffer);
        
        this.writeString(view, 0, 'RIFF'); view.setUint32(4, fileSize, true); this.writeString(view, 8, 'WAVE');
        let offset = 12;
        for (const chunk of headerChunks) { new Uint8Array(buffer, offset).set(new Uint8Array(chunk)); offset += chunk.byteLength; }
        
        this.writeString(view, offset, 'data'); view.setUint32(offset + 4, sampleSize, true);
        offset += 8;
        
        new Uint8Array(buffer, offset).set(new Uint8Array(modifiedSamples.buffer));
        
        return new Blob([buffer], { type: 'audio/wav' });
    }
}


/**
 * WebStegano Class (with correct Chi-Square logic)
 */
class WebStegano {
    static IV_LENGTH_BYTES = 12; static SALT_LENGTH_BYTES = 16; static PBKDF2_ITERATIONS = 100000;
    static HEADER_BIT_LENGTH = 40; static HEADER_EMBED_DEPTH = 1; 

    static async deriveKey(password, salt = null) {
        const encoder = new TextEncoder(); const passwordBuffer = encoder.encode(password);
        if (!salt) salt = crypto.getRandomValues(new Uint8Array(this.SALT_LENGTH_BYTES));
        const baseKey = await crypto.subtle.importKey("raw", passwordBuffer, { name: "PBKDF2" }, false, ["deriveKey"]);
        const aesKey = await crypto.subtle.deriveKey(
            { name: "PBKDF2", salt: salt, iterations: this.PBKDF2_ITERATIONS, hash: "SHA-256" },
            baseKey, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]
        );
        return { aesKey, salt };
    }
    static async encrypt(data, password) {
        const { aesKey, salt } = await this.deriveKey(password);
        const iv = crypto.getRandomValues(new Uint8Array(this.IV_LENGTH_BYTES));
        const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, aesKey, data);
        const cipherBuffer = new Uint8Array(ciphertext);
        const result = new Uint8Array(salt.length + iv.length + cipherBuffer.length);
        result.set(salt, 0); result.set(iv, salt.length); result.set(cipherBuffer, salt.length + iv.length);
        return result;
    }
    static async decrypt(payload, password) {
        try {
            const salt = payload.slice(0, this.SALT_LENGTH_BYTES);
            const iv = payload.slice(this.SALT_LENGTH_BYTES, this.SALT_LENGTH_BYTES + this.IV_LENGTH_BYTES);
            const ciphertext = payload.slice(this.SALT_LENGTH_BYTES + this.IV_LENGTH_BYTES);
            if (salt.length !== this.SALT_LENGTH_BYTES || iv.length !== this.IV_LENGTH_BYTES || ciphertext.length === 0) throw new Error("Invalid payload structure.");
            const { aesKey } = await this.deriveKey(password, salt);
            const decryptedBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, aesKey, ciphertext);
            return decryptedBuffer;
        } catch (e) {
            console.error("Decryption failed:", e);
            throw new Error("Decryption failed. Invalid password or corrupted data.");
        }
    }
    
    static async embedLSB(carrierData, message, password, options, getCapacity, embedBits) {
        const { compression, bitDepth } = options;
        const encoder = new TextEncoder();
        let dataToEncrypt = encoder.encode(message);
        if (compression) dataToEncrypt = pako.deflate(dataToEncrypt);
        const encrypted = await this.encrypt(dataToEncrypt, password);
        let payloadBinary = '';
        for (let i = 0; i < encrypted.length; i++) payloadBinary += encrypted[i].toString(2).padStart(8, '0');
        let metaByte = 0;
        metaByte |= ((bitDepth - 1) & 0x03); 
        if (compression) metaByte |= 0x04;
        const metaBinary = metaByte.toString(2).padStart(8, '0');
        const lengthBinary = payloadBinary.length.toString(2).padStart(32, '0');
        const headerBinary = metaBinary + lengthBinary;
        const headerCapacity = getCapacity(this.HEADER_EMBED_DEPTH);
        if (this.HEADER_BIT_LENGTH > headerCapacity) throw new Error('Carrier is too small to even hide the header.');
        const availablePayloadCapacity = getCapacity(bitDepth) - (this.HEADER_BIT_LENGTH * (bitDepth / this.HEADER_EMBED_DEPTH));
        if (payloadBinary.length > availablePayloadCapacity) {
             throw new Error(`Message too large. Required: ${payloadBinary.length} bits. Available: ${Math.floor(availablePayloadCapacity)} bits.`);
        }
        let dataIndex = embedBits(carrierData, headerBinary, this.HEADER_EMBED_DEPTH, 0);
        embedBits(carrierData, payloadBinary, bitDepth, dataIndex);
    }
    
    static async extractLSB(carrierData, password, extractBits) {
        const { binary: headerBinary, nextIndex } = extractBits(carrierData, this.HEADER_EMBED_DEPTH, this.HEADER_BIT_LENGTH, 0);
        const metaBinary = headerBinary.substr(0, 8);
        const lengthBinary = headerBinary.substr(8, 40);
        const metaByte = parseInt(metaBinary, 2);
        const length = parseInt(lengthBinary, 2);
        const bitDepth = (metaByte & 0x03) + 1;
        const hasCompression = (metaByte & 0x04) > 0;
        if (length <= 0 || isNaN(length)) throw new Error('Invalid length header. Data may be corrupt, password is wrong, or no message exists.');
        const { binary: payloadBinary } = extractBits(carrierData, bitDepth, length, nextIndex);
        if (payloadBinary.length % 8 !== 0) throw new Error("Corrupted data: extracted binary length is not a multiple of 8.");
        const encrypted = new Uint8Array(payloadBinary.length / 8);
        for (let i = 0; i < encrypted.length; i++) {
            const byteBinary = payloadBinary.substr(i * 8, 8);
            encrypted[i] = parseInt(byteBinary, 2);
        }
        const decryptedData = await this.decrypt(encrypted, password);
        let decompressedData = decryptedData;
        if (hasCompression) {
            try { decompressedData = pako.inflate(decryptedData); } 
            catch (e) { throw new Error("Failed to decompress data. " + e.message); }
        }
        const decoder = new TextDecoder();
        return decoder.decode(decompressedData);
    }
    
    /**
     * This is the Chi-Square "Pairs of Values" (PoV) test.
     */
    static chiSquareAnalysis(imageData, sensitivityMultiplier = 1.5) {
        const data = imageData.data;
        const histograms = [new Uint32Array(256).fill(0), new Uint32Array(256).fill(0), new Uint32Array(256).fill(0)];
        for (let i = 0; i < data.length; i += 4) {
            histograms[0][data[i]]++;
            histograms[1][data[i+1]]++;
            histograms[2][data[i+2]]++;
        }
        
        let totalChiSquare = 0;
        let totalPairsAnalyzed = 0; // This is our degrees of freedom (df)
        
        for (let ch = 0; ch < 3; ch++) {
            const histogram = histograms[ch];
            for (let i = 0; i < 128; i++) {
                const even = histogram[i * 2];
                const odd = histogram[i * 2 + 1];
                const expected = (even + odd) / 2;
                
                if (expected > 0) {
                    totalChiSquare += Math.pow(even - expected, 2) / expected;
                    totalChiSquare += Math.pow(odd - expected, 2) / expected;
                    totalPairsAnalyzed += 1; // This is one pair (1 degree of freedom)
                }
            }
        }

        if (totalPairsAnalyzed === 0) {
            return { 
                method: 'Chi-Square Analysis (RGB)', 
                chiSquare: '0.00', 
                pairsAnalyzed: 0, 
                isStegoDetected: false, 
                confidence: 0 
            };
        }

        // This is the average Chi-Square value per degree of freedom.
        const avgChiSquare = totalChiSquare / totalPairsAnalyzed;
        
        const threshold = sensitivityMultiplier; // Default is now 2.5
        const isStegoDetected = avgChiSquare > threshold;
        
        let confidence;
        if (isStegoDetected) {
            confidence = Math.min((avgChiSquare - threshold) / (avgChiSquare) * 100, 100);
        } else {
            confidence = 0; 
        }

        return { 
            method: 'Chi-Square Analysis (RGB)', 
            chiSquare: avgChiSquare.toFixed(2), 
            pairsAnalyzed: totalPairsAnalyzed, 
            isStegoDetected, 
            confidence: Math.max(0, confidence).toFixed(2) 
        };
    }
    
    static calculatePSNR(imageData1, imageData2) {
        const data1 = imageData1.data; const data2 = imageData2.data;
        if (data1.length !== data2.length) throw new Error('Images must be the same size');
        let mse = 0;
        for (let i = 0; i < data1.length; i += 4) {
            for (let j = 0; j < 3; j++) mse += Math.pow(data1[i + j] - data2[i + j], 2);
        }
        mse = mse / (data1.length * 0.75);
        if (mse === 0) return Infinity;
        return 20 * Math.log10(255 / Math.sqrt(mse));
    }
    static calculateMSE(imageData1, imageData2) {
        const data1 = imageData1.data; const data2 = imageData2.data;
        let mse = 0;
        for (let i = 0; i < data1.length; i += 4) {
            for (let j = 0; j < 3; j++) mse += Math.pow(data1[i + j] - data2[i + j], 2);
        }
        return mse / (data1.length * 0.75);
    }
}

/**
 * UI Controller
 */
class UIController {
    constructor() {
        this.analysisCache = new Map();
        this.initTheme();
        this.initMainTabs();
        this.initSubTabs('embed');
        this.initSubTabs('extract');
        this.initSubTabs('analyze');
        this.initFileUploads();
        this.initButtons();
        this.initListeners();
    }
    
    // --- Initializers ---
    initTheme() {
        this.themeToggle = document.getElementById('theme-toggle');
        
        const savedTheme = localStorage.getItem('theme') || 'dark';
        this.setTheme(savedTheme);

        this.themeToggle.addEventListener('click', () => {
            const newTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
            this.setTheme(newTheme);
        });
    }

    setTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
        try {
            lucide.createIcons(); 
        } catch(e) {
            console.error("Lucide icons failed to render.", e);
        }
    }
    
    initMainTabs() {
        const navLinks = document.querySelectorAll('.nav-link');
        const tabs = document.querySelectorAll('.tab');
        const allTabButtons = [...navLinks, ...tabs];

        allTabButtons.forEach(tab => {
            tab.addEventListener('click', (e) => {
                e.preventDefault();
                const tabName = e.currentTarget.getAttribute('data-tab') || e.currentTarget.hash.substring(1);
                
                document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.getAttribute('data-tab') === tabName));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === tabName));
                
                document.querySelectorAll('.nav-link').forEach(n => n.classList.toggle('active', n.getAttribute('data-tab') === tabName));
                
                this.hideAlert();
                window.scrollTo({ top: document.querySelector('.main-content').offsetTop - 100, behavior: 'smooth' });
            });
        });
    }
    
    initSubTabs(prefix) {
        document.querySelectorAll(`#${prefix} .sub-tab`).forEach(tab => {
            tab.addEventListener('click', (e) => {
                const tabName = e.currentTarget.getAttribute('data-tab');
                document.querySelectorAll(`#${prefix} .sub-tab`).forEach(t => t.classList.remove('active'));
                document.querySelectorAll(`#${prefix} .sub-tab-content`).forEach(c => c.classList.remove('active'));
                e.currentTarget.classList.add('active');
                document.getElementById(tabName).classList.add('active');
                this.hideAlert();
            });
        });
    }
    
    initFileUploads() {
        this.setupFileUpload('embedUploadImage', 'embedFileImage', 'embedPreviewImage');
        this.setupFileUpload('embedUploadAudio', 'embedFileAudio', 'embedPreviewAudio');
        this.setupFileUpload('extractUploadImage', 'extractFileImage', 'extractPreviewImage');
        this.setupFileUpload('extractUploadAudio', 'extractFileAudio', 'extractPreviewAudio');
        this.setupFileUpload('detectUploadImage', 'detectFileImage', 'detectFilePreviewList'); 
        this.setupFileUpload('evalCoverUploadImage', 'evalCoverFileImage', 'evalPreviewImage');
        this.setupFileUpload('evalStegoUploadImage', 'evalStegoFileImage', 'evalPreviewImage');
    }
    
    setupFileUpload(uploadId, fileId, previewId) {
        const uploadDiv = document.getElementById(uploadId);
        const fileInput = document.getElementById(fileId);
        const preview = document.getElementById(previewId);
        if (!uploadDiv || !fileInput || !preview) return;
        
        const clickFn = () => fileInput.click();
        uploadDiv.addEventListener('click', clickFn);
        
        ['dragover', 'dragleave', 'drop'].forEach(eventName => {
            uploadDiv.addEventListener(eventName, (e) => {
                e.preventDefault(); e.stopPropagation();
                if (eventName === 'dragover') uploadDiv.classList.add('dragover');
                if (eventName === 'dragleave') uploadDiv.classList.remove('dragover');
                if (eventName === 'drop') {
                    uploadDiv.classList.remove('dragover');
                    if (e.dataTransfer.files.length) {
                        fileInput.files = e.dataTransfer.files;
                        this.handleFileSelect(fileInput, preview, uploadId, clickFn);
                    }
                }
            });
        });
        fileInput.addEventListener('change', () => this.handleFileSelect(fileInput, preview, uploadId, clickFn));
    }
    
    handleFileSelect(fileInput, preview, uploadId, clickFn) {
        const files = fileInput.files;
        if (!files || files.length === 0) {
            preview.innerHTML = '';
            if (uploadId === 'detectUploadImage') preview.style.display = 'none';
            if (uploadId === 'embedPreviewAudio') preview.style.display = 'none';
            if (uploadId === 'extractPreviewAudio') preview.style.display = 'none';
            return;
        }
        
        if (uploadId === 'detectUploadImage') {
            preview.innerHTML = ''; // Clear list
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                if (!file.type.startsWith('image/')) continue;
                preview.innerHTML += `
                    <div class="file-item" data-file-index="${i}">
                        <span>${this.escapeHtml(file.name)}</span>
                        <small>${(file.size / 1024).toFixed(1)} KB</small>
                    </div>`;
            }
            preview.style.display = 'block';
            return; 
        }
        
        const file = files[0]; const fileType = file.type;
        
        if (fileType.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    if (uploadId.startsWith('eval')) {
                        const uploadDiv = document.getElementById(uploadId);
                        uploadDiv.innerHTML = `<input type="file" id="${fileInput.id}" accept="image/*" style="display: none;"><img src="${e.target.result}" alt="Preview" style="width:100px; height: 100px; object-fit: cover; border-radius: 8px;"><p style="font-size: 12px; margin-top: 8px;">${file.name}</p>`;
                        uploadDiv.addEventListener('click', clickFn);
                    } else {
                        preview.innerHTML = `<div class="preview-card"><img src="${e.target.result}" alt="Preview"><div class="preview-info"><h4>${file.name}</h4><p>Size: ${(file.size / 1024).toFixed(2)} KB | Dimensions: ${img.width}x${img.height}</p></div></div>`;
                    }
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        } 
        else if (fileType.startsWith('audio/wav') || fileType.startsWith('audio/wave')) {
            const audioUrl = URL.createObjectURL(file);
            preview.innerHTML = `<audio controls src="${audioUrl}"></audio><div class="audio-preview-info"><h4>${file.name}</h4><p>Size: ${(file.size / 1024 / 1024).toFixed(2)} MB</p></div>`;
            preview.style.display = 'block';
        }
        else {
            this.showAlert(`Unsupported file type: ${fileType}. Please select a supported file.`, 'danger');
            fileInput.value = null;
        }
    }
    
    initButtons() {
        // Embed
        document.getElementById('embedBtnImage')?.addEventListener('click', () => this.embedImage());
        document.getElementById('embedBtnAudio')?.addEventListener('click', () => this.embedAudio());
        document.getElementById('clearEmbedBtnImage')?.addEventListener('click', () => this.clearTab('embed-image'));
        document.getElementById('clearEmbedBtnAudio')?.addEventListener('click', () => this.clearTab('embed-audio'));
        
        // Extract
        document.getElementById('extractBtnImage')?.addEventListener('click', () => this.extractImage());
        document.getElementById('extractBtnAudio')?.addEventListener('click', () => this.extractAudio());
        document.getElementById('clearExtractBtnImage')?.addEventListener('click', () => this.clearTab('extract-image'));
        document.getElementById('clearExtractBtnAudio')?.addEventListener('click', () => this.clearTab('audio-extract'));

        // Analyze
        document.getElementById('detectBtnImage')?.addEventListener('click', () => this.analyzeAllImages());
        document.getElementById('evaluateBtnImage')?.addEventListener('click', () => this.evaluateQuality());
        document.getElementById('clearDetectBtnImage')?.addEventListener('click', () => this.clearTab('analyze-detect'));
        document.getElementById('clearEvalBtnImage')?.addEventListener('click', () => this.clearTab('analyze-evaluate'));
    }
    
    initListeners() {
        // Lucide Icons
        try { lucide.createIcons(); } catch(e) { console.error('Lucide icons failed to load.', e); }
        
        // Sensitivity Slider
        document.getElementById('detectSensitivity')?.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value) / 100;
            document.getElementById('sensitivityLabel').textContent = `${value.toFixed(2)}x ${value > 3.0 ? '(Low)' : value < 1.5 ? '(High)' : '(Default)'}`;
        });
        
        // FAQ Accordion
        document.getElementById('faq-list')?.addEventListener('click', (e) => {
            const question = e.target.closest('.faq-question');
            if (question) {
                const item = question.parentElement;
                item.classList.toggle('active');
                try { lucide.createIcons(); } catch(e) { console.error('Lucide icons failed to load.', e); }
            }
        });
    }

    // --- IMAGE ACTIONS ---
    async embedImage() {
        const fileInput = document.getElementById('embedFileImage');
        const message = document.getElementById('embedMessageImage').value;
        const password = document.getElementById('embedPasswordImage').value;
        const bitDepth = parseInt(document.getElementById('embedBitDepthImage').value, 10);
        const compression = document.getElementById('embedCompressionImage').checked;
        if (!fileInput.files[0] || !message.trim() || !password.trim()) {
            this.showAlert('Please select an image, enter a message, and provide a password.', 'danger'); return;
        }
        this.showLoading('embedLoadingImage');
        try {
            const canvas = await this.imageToCanvas(fileInput.files[0]);
            const ctx = canvas.getContext('2d');
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height, { willReadFrequently: true });
            const getCapacity = (depth) => Math.floor(imageData.data.length / 4 * 3) * depth;
            const embedBits = (carrier, binary, depth, startIndex) => {
                const mask = (0xFF << depth) & 0xFF; let dataIndex = startIndex;
                for (let i = 0; i < binary.length; i += depth) {
                    while ((dataIndex + 1) % 4 === 0) { dataIndex++; }
                    if (dataIndex >= carrier.length) throw new Error("Carrier overflow");
                    const bitsValue = parseInt(binary.substr(i, depth).padEnd(depth, '0'), 2);
                    carrier[dataIndex] = (carrier[dataIndex] & mask) | bitsValue;
                    dataIndex++;
                } return dataIndex;
            };
            await WebStegano.embedLSB(imageData.data, message, password, { bitDepth, compression }, getCapacity, embedBits);
            ctx.putImageData(imageData, 0, 0);
            const stegoUrl = canvas.toDataURL('image/png');
            const uncompressedSize = new TextEncoder().encode(message).length;
            const compressedSize = compression ? pako.deflate(new TextEncoder().encode(message)).length : uncompressedSize;
            document.getElementById('embedResultImage').innerHTML = `
                <div class="result-box success"><div class="result-title"><i data-lucide="check-circle"></i> Message Embedded Successfully!</div><div class="result-content"><p><strong>Your secret message has been compressed, encrypted, and hidden in the image.</strong></p><p style="margin-top: 16px;"><strong>Settings Used:</strong> ${bitDepth}-bit LSB, Compression: ${compression ? 'On' : 'Off'}. These will be auto-detected on extraction.</p></div></div>
                <div class="image-preview"><div class="preview-card">
                    <img src="${stegoUrl}" alt="Stego Image">
                    <div class="preview-info"><h4>Stego Image</h4><p>Right-click and save this image</p>
                    <a href="${stegoUrl}" download="stego_image.png" class="btn btn-primary" style="margin-top: 12px; text-decoration: none;"><i data-lucide="download"></i> Download Stego Image</a>
                </div></div></div>
                <div class="stats-grid">
                    <div class="stat-card"><div class="stat-value">${uncompressedSize}</div><div class="stat-label">Original Size (bytes)</div></div>
                    <div class="stat-card"><div class="stat-value">${compressedSize}</div><div class="stat-label">Compressed Size (bytes)</div></div>
                    <div class="stat-card"><div class="stat-value">${(uncompressedSize > 0 ? (100 - (compressedSize / uncompressedSize * 100)) : 0).toFixed(1)}%</div><div class="stat-label">Space Saved</div></div>
                </div>`;
            try { lucide.createIcons(); } catch(e) {}
            this.showAlert('Message embedded successfully!', 'success');
        } catch (error) {
            console.error("Embed Image Error:", error); this.showAlert('Error: ' + error.message, 'danger');
        } finally {
            this.hideLoading('embedLoadingImage');
        }
    }
    async extractImage() {
        const fileInput = document.getElementById('extractFileImage');
        const password = document.getElementById('extractPasswordImage').value.trim();
        if (!fileInput.files[0] || !password) {
            this.showAlert('Please select an image and enter the password.', 'danger'); return;
        }
        this.showLoading('extractLoadingImage');
        try {
            const canvas = await this.imageToCanvas(fileInput.files[0]);
            const ctx = canvas.getContext('2d');
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height, { willReadFrequently: true });
            const extractBits = (carrier, depth, numBits, startIndex) => {
                const mask = (1 << depth) - 1; let binary = ''; let dataIndex = startIndex;
                const bitsToExtract = Math.ceil(numBits / depth);
                for (let i = 0; i < bitsToExtract; i++) {
                    while ((dataIndex + 1) % 4 === 0) { dataIndex++; }
                    if (dataIndex >= carrier.length) throw new Error("Carrier overflow");
                    binary += (carrier[dataIndex] & mask).toString(2).padStart(depth, '0');
                    dataIndex++;
                } return { binary: binary.substr(0, numBits), nextIndex: dataIndex };
            };
            const message = await WebStegano.extractLSB(imageData.data, password, extractBits);
            document.getElementById('extractResultImage').innerHTML = `
                <div class="result-box success">
                    <div class="result-title"><i data-lucide="check-circle"></i> Message Extracted & Authenticated!</div>
                    <div class="result-content"><p><strong>📨 Hidden Message:</strong></p>
                        <div style="background: var(--bg-dark); padding: 20px; border: 2px solid var(--border); margin-top: 12px; font-size: 16px; line-height: 1.6; color: var(--text-primary); white-space: pre-wrap; word-break: break-word;">
                            ${this.escapeHtml(message)}
                        </div>
                    </div>
                </div>
                <div class="stats-grid">
                    <div class="stat-card"><div class="stat-value">${message.length}</div><div class="stat-label">Characters</div></div>
                    <div class="stat-card"><div class="stat-value">${message.split(/\s+/).filter(Boolean).length}</div><div class="stat-label">Words</div></div>
                </div>`;
            try { lucide.createIcons(); } catch(e) {}
            this.showAlert('Message extracted successfully!', 'success');
        } catch (error) {
            console.error("Extract Image Error:", error); this.showAlert('Extraction failed: ' + error.message, 'danger');
        } finally {
            this.hideLoading('extractLoadingImage');
        }
    }
    
    async analyzeAllImages() {
        const fileInput = document.getElementById('detectFileImage');
        if (!fileInput.files || fileInput.files.length === 0) {
            this.showAlert('Please select one or more images to analyze', 'danger'); return;
        }
        
        let hasJpeg = false;
        for (let i = 0; i < fileInput.files.length; i++) {
            const fileType = fileInput.files[i].type;
            if (fileType === 'image/jpeg' || fileType === 'image/jpg') {
                hasJpeg = true;
                break;
            }
        }
        if (hasJpeg) {
            this.showAlert(
                'Warning: JPEG file(s) detected. Analysis on lossy formats like JPEG is unreliable and often produces false positives. Use lossless PNGs for accurate results.',
                'warning'
            );
        } else {
            this.hideAlert(); // Clear any old alerts if all files are fine
        }
        
        this.showLoading('detectLoadingImage');
        document.getElementById('detectResultSummary').style.display = 'block';
        document.getElementById('detectDetailResultImage').style.display = 'none';
        const tableBody = document.getElementById('detectSummaryTableBody');
        tableBody.innerHTML = '';
        this.analysisCache.clear();
        
        const sensitivity = parseFloat(document.getElementById('detectSensitivity').value) / 100;
        const files = fileInput.files;
        let detectedCount = 0;

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (!file.type.startsWith('image/')) continue;
            
            tableBody.insertAdjacentHTML('beforeend', `
                <tr data-file-index="${i}" id="row-${i}">
                    <td>${this.escapeHtml(file.name)}</td>
                    <td><div class="spinner" style="width:20px;height:20px;margin:0;"></div></td>
                    <td>Analyzing...</td>
                    <td></td>
                </tr>`);
            
            let chiResult, histResult, errorMsg;
            try {
                const canvas = await this.imageToCanvas(file);
                const ctx = canvas.getContext('2d');
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height, { willReadFrequently: true });
                chiResult = WebStegano.chiSquareAnalysis(imageData, sensitivity);
                histResult = HistogramHelper.analyze(imageData);
            } catch (e) { errorMsg = e.message; }
            
            this.analysisCache.set(i, { file, chiResult, histResult, errorMsg });
            if (chiResult?.isStegoDetected) detectedCount++;
            
            const row = document.getElementById(`row-${i}`);
            if (row) { // Check if row still exists (user might have cleared)
                row.innerHTML = `
                    <td>${this.escapeHtml(file.name)}</td>
                    <td>${chiResult ? chiResult.chiSquare : 'N/A'}</td>
                    <td class="${chiResult?.isStegoDetected ? 'status-detected' : 'status-clean'}">
                        ${chiResult ? (chiResult.isStegoDetected ? '🚨 DETECTED' : '✅ CLEAN') : 'Error'}
                    </td>
                    <td><button class="btn btn-secondary btn-small" onclick="uiController.showAnalysisDetails(${i})">Details</button></td>
                `;
            }
        }
        
        this.hideLoading('detectLoadingImage');
        if (!hasJpeg) {
             if (detectedCount > 0) {
                this.showAlert(`Analysis complete. ${detectedCount} suspicious file(s) detected.`, 'warning');
            } else {
                this.showAlert('Analysis complete. No steganography detected.', 'success');
            }
        }
    }
    
    showAnalysisDetails(fileIndex) {
        const result = this.analysisCache.get(fileIndex);
        if (!result) return;
        const { file, chiResult, histResult, errorMsg } = result;
        const detailDiv = document.getElementById('detectDetailResultImage');
        
        if (errorMsg) {
            detailDiv.innerHTML = `<div class="result-box danger"><div class="result-title"><i data-lucide="alert-triangle"></i> Analysis Failed for ${this.escapeHtml(file.name)}</div><p>${errorMsg}</p></div>`;
            detailDiv.style.display = 'block';
            detailDiv.scrollIntoView({ behavior: 'smooth' });
            try { lucide.createIcons(); } catch(e) {}
            return;
        }
        
        const detectionClass = chiResult.isStegoDetected ? 'danger' : 'success';
        const detectionBadge = chiResult.isStegoDetected ? 'detected' : 'clean';
        const detectionText = chiResult.isStegoDetected ? 'STEGANOGRAPHY DETECTED' : 'IMAGE APPEARS CLEAN';
        const detectionIcon = chiResult.isStegoDetected ? 'siren' : 'shield-check';
        
        detailDiv.innerHTML = `
            <h3 style="color: var(--secondary); margin-bottom: 16px;">Detailed Report for: ${this.escapeHtml(file.name)}</h3>
            
            <div class="result-box ${detectionClass}">
                <div class="result-title"><i data-lucide="${detectionIcon}"></i> Chi-Square Result: ${detectionText}</div>
                <div class="result-content">
                    <p>${chiResult.isStegoDetected ? 
                        'Statistical analysis indicates this image likely contains random data (High Chi-Square).' : 
                        'Statistical analysis suggests this image has natural patterns (Low Chi-Square).'
                    }</p>
                </div>
            </div>
            <div class="analysis-card">
                <div class="analysis-header">
                    <h4>📊 ${chiResult.method}</h4>
                    <span class="analysis-badge ${detectionBadge}">${chiResult.isStegoDetected ? 'Detected' : 'Clean'}</span>
                </div>
                <p><strong>Avg. Chi-Square Value:</strong> ${chiResult.chiSquare}</p>
                <p><strong>Pairs Analyzed:</strong> ${chiResult.pairsAnalyzed}</p>
                <p><strong>Confidence:</strong> ${chiResult.confidence}%</p>
                <p style="font-size: 12px; color: var(--text-secondary); margin-top: 10px;">This value is the average Chi-Square statistic. A natural **PNG** image (like a screenshot) is expected to have a value near <strong>0</strong>. A value significantly higher (e.g., > ${ (parseFloat(document.getElementById('detectSensitivity').value) / 100).toFixed(2) }) indicates randomness from steganography, camera noise, or JPEG compression.</p>
            </div>

            <div class="analysis-card">
                <div class="analysis-header">
                    <h4>📊 LSB Histogram Analysis</h4>
                </div>
                <p>This chart shows the distribution of R, G, and B color values. Look for a "combing" effect (alternating high/low bars) which can indicate simple, unencrypted LSB steganography.</p>
                <div class="histogram-container">
                    <canvas id="histogramCanvas" width="512" height="250"></canvas>
                </div>
            </div>
        `;
        
        detailDiv.style.display = 'block';
        setTimeout(() => {
            const canvas = document.getElementById('histogramCanvas');
            if (canvas) {
                const gridColor = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary');
                HistogramHelper.draw(canvas, histResult, gridColor);
                canvas.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            try { lucide.createIcons(); } catch(e) {}
        }, 50);
    }
    
    async evaluateQuality() {
        const coverInput = document.getElementById('evalCoverFileImage');
        const stegoInput = document.getElementById('evalStegoFileImage');
        if (!coverInput.files[0] || !stegoInput.files[0]) {
            this.showAlert('Please select both cover and stego images', 'danger'); return;
        }
        this.showLoading('evalLoadingImage');
        try {
            const coverCanvas = await this.imageToCanvas(coverInput.files[0]);
            const stegoCanvas = await this.imageToCanvas(stegoInput.files[0]);
            if (coverCanvas.width !== stegoCanvas.width || coverCanvas.height !== stegoCanvas.height) {
                throw new Error('Images must have the same dimensions');
            }
            const coverData = coverCanvas.getContext('2d').getImageData(0, 0, coverCanvas.width, coverCanvas.height, { willReadFrequently: true });
            const stegoData = stegoCanvas.getContext('2d').getImageData(0, 0, stegoCanvas.width, stegoCanvas.height, { willReadFrequently: true });
            const psnr = WebStegano.calculatePSNR(coverData, stegoData);
            const mse = WebStegano.calculateMSE(coverData, stegoData);
            let qualityRating, qualityColor;
            if (psnr > 40) { qualityRating = 'Excellent - Imperceptible'; qualityColor = 'success'; }
            else if (psnr > 30) { qualityRating = 'Good'; qualityColor = 'success'; }
            else if (psnr > 20) { qualityRating = 'Fair'; qualityColor = 'warning'; }
            else { qualityRating = 'Poor'; qualityColor = 'danger'; }
            document.getElementById('evalResultImage').innerHTML = `
                <div class="result-box ${qualityColor}">
                    <div class="result-title">📊 Quality Assessment: ${qualityRating}</div>
                    <div class="result-content">
                        <p>The stego image maintains ${psnr > 40 ? 'excellent' : psnr > 30 ? 'good' : 'acceptable'} visual quality compared to the original.</p>
                    </div>
                </div>
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-value">${psnr === Infinity ? '∞' : psnr.toFixed(2)}</div>
                        <div class="stat-label">PSNR (dB)</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">${mse.toFixed(4)}</div>
                        <div class="stat-label">MSE</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">${coverCanvas.width}x${coverCanvas.height}</div>
                        <div class="stat-label">Dimensions</div>
                    </div>
                </div>
                <div class="analysis-card">
                    <h4>📈 Metric Explanations</h4>
                    <p><strong>PSNR (Peak Signal-to-Noise Ratio):</strong> Higher is better. Values above 40 dB indicate imperceptible differences.</p>
                    <p style="margin-top: 8px;"><strong>MSE (Mean Squared Error):</strong> Lower is better. Measures average pixel-level differences.</p>
                </div>
            `;
            this.showAlert('Quality evaluation complete', 'success');
        } catch (error) {
            console.error("Evaluate Error:", error); this.showAlert('Evaluation failed: ' + error.message, 'danger');
        } finally {
            this.hideLoading('evalLoadingImage');
        }
    }
    
    // --- AUDIO ACTIONS ---
    async embedAudio() {
        const fileInput = document.getElementById('embedFileAudio');
        const message = document.getElementById('embedMessageAudio').value;
        const password = document.getElementById('embedPasswordAudio').value;
        const bitDepth = parseInt(document.getElementById('embedBitDepthAudio').value, 10);
        const compression = document.getElementById('embedCompressionAudio').checked;
        if (!fileInput.files[0] || !message.trim() || !password.trim()) {
            this.showAlert('Please select a WAV file, enter a message, and provide a password.', 'danger'); return;
        }
        this.showLoading('embedLoadingAudio');
        try {
            const arrayBuffer = await fileInput.files[0].arrayBuffer();
            const wavInfo = WavHelper.parse(arrayBuffer);
            const sampleView = (wavInfo.fmtChunk.bitsPerSample === 8) ? wavInfo.samples : new Uint8Array(wavInfo.samples.buffer, wavInfo.samples.byteOffset, wavInfo.samples.byteLength);
            const getCapacity = (depth) => sampleView.length * depth;
            const embedBits = (carrier, binary, depth, startIndex) => {
                const mask = (0xFF << depth) & 0xFF; let dataIndex = startIndex;
                for (let i = 0; i < binary.length; i += depth) {
                    if (dataIndex >= carrier.length) throw new Error("Carrier overflow");
                    const bitsValue = parseInt(binary.substr(i, depth).padEnd(depth, '0'), 2);
                    carrier[dataIndex] = (carrier[dataIndex] & mask) | bitsValue;
                    dataIndex++;
                } return dataIndex;
            };
            await WebStegano.embedLSB(sampleView, message, password, { bitDepth, compression }, getCapacity, embedBits);
            const newWavBlob = WavHelper.build(wavInfo.fmtChunk, wavInfo.headerChunks, wavInfo.samples);
            const stegoUrl = URL.createObjectURL(newWavBlob);
            const uncompressedSize = new TextEncoder().encode(message).length;
            const compressedSize = compression ? pako.deflate(new TextEncoder().encode(message)).length : uncompressedSize;
            document.getElementById('embedResultAudio').innerHTML = `
                <div class="result-box success"><div class="result-title"><i data-lucide="check-circle"></i> Message Embedded Successfully!</div><div class="result-content"><p><strong>Your secret message has been compressed, encrypted, and hidden in the WAV file.</strong></p><p style="margin-top: 16px;"><strong>Settings Used:</strong> ${bitDepth}-bit LSB, Compression: ${compression ? 'On' : 'Off'}. These will be auto-detected on extraction.</p></div></div>
                <div class="audio-preview">
                    <audio controls src="${stegoUrl}"></audio>
                    <div class="audio-preview-info"><h4>Stego Audio File</h4><p>You can play the audio to confirm it's not corrupted.</p>
                    <a href="${stegoUrl}" download="stego_audio.wav" class="btn btn-primary" style="margin-top: 12px; text-decoration: none;"><i data-lucide="download"></i> Download Stego WAV</a>
                </div></div>
                <div class="stats-grid">
                    <div class="stat-card"><div class="stat-value">${uncompressedSize}</div><div class="stat-label">Original Size (bytes)</div></div>
                    <div class="stat-card"><div class="stat-value">${compressedSize}</div><div class="stat-label">Compressed Size (bytes)</div></div>
                    <div class="stat-card"><div class="stat-value">${(uncompressedSize > 0 ? (100 - (compressedSize / uncompressedSize * 100)) : 0).toFixed(1)}%</div><div class="stat-label">Space Saved</div></div>
                </div>`;
            try { lucide.createIcons(); } catch(e) {}
            this.showAlert('Message embedded successfully!', 'success');
        } catch (error) {
            console.error("Embed Audio Error:", error); this.showAlert('Error: ' + error.message, 'danger');
        } finally {
            this.hideLoading('embedLoadingAudio');
        }
    }
    async extractAudio() {
        const fileInput = document.getElementById('extractFileAudio');
        const password = document.getElementById('extractPasswordAudio').value.trim();
        if (!fileInput.files[0] || !password) {
            this.showAlert('Please select a WAV file and enter the password.', 'danger'); return;
        }
        this.showLoading('extractLoadingAudio');
        try {
            const arrayBuffer = await fileInput.files[0].arrayBuffer();
            const wavInfo = WavHelper.parse(arrayBuffer);
            const sampleView = (wavInfo.fmtChunk.bitsPerSample === 8) ? wavInfo.samples : new Uint8Array(wavInfo.samples.buffer, wavInfo.samples.byteOffset, wavInfo.samples.byteLength);
            const extractBits = (carrier, depth, numBits, startIndex) => {
                const mask = (1 << depth) - 1; let binary = ''; let dataIndex = startIndex;
                const bitsToExtract = Math.ceil(numBits / depth);
                for (let i = 0; i < bitsToExtract; i++) {
                    if (dataIndex >= carrier.length) throw new Error("Carrier overflow");
                    binary += (carrier[dataIndex] & mask).toString(2).padStart(depth, '0');
                    dataIndex++;
                } return { binary: binary.substr(0, numBits), nextIndex: dataIndex };
            };
            const message = await WebStegano.extractLSB(sampleView, password, extractBits);
            document.getElementById('extractResultAudio').innerHTML = `
                <div class="result-box success">
                    <div class="result-title"><i data-lucide="check-circle"></i> Message Extracted & Authenticated!</div>
                    <div class="result-content"><p><strong>📨 Hidden Message:</strong></p>
                        <div style="background: var(--bg-dark); padding: 20px; border: 2px solid var(--border); margin-top: 12px; font-size: 16px; line-height: 1.6; color: var(--text-primary); white-space: pre-wrap; word-break: break-word;">
                            ${this.escapeHtml(message)}
                        </div>
                    </div>
                </div>
                <div class="stats-grid">
                    <div class="stat-card"><div class="stat-value">${message.length}</div><div class="stat-label">Characters</div></div>
                    <div class="stat-card"><div class="stat-value">${message.split(/\s+/).filter(Boolean).length}</div><div class="stat-label">Words</div></div>
                </div>`;
            try { lucide.createIcons(); } catch(e) {}
            this.showAlert('Message extracted successfully!', 'success');
        } catch (error) {
            console.error("Extract Audio Error:", error); this.showAlert('Extraction failed: ' + error.message, 'danger');
        } finally {
            this.hideLoading('extractLoadingAudio');
        }
    }


    // --- UTILITY FUNCTIONS ---
    
    clearTab(tabId) {
        // Embed Image
        if (tabId === 'embed-image') {
            document.getElementById('embedFileImage').value = null;
            document.getElementById('embedPreviewImage').innerHTML = '';
            document.getElementById('embedMessageImage').value = '';
            document.getElementById('embedPasswordImage').value = '';
            document.getElementById('embedResultImage').innerHTML = '';
            document.getElementById('embedBitDepthImage').value = '1';
            document.getElementById('embedCompressionImage').checked = true;
        } 
        // Extract Image
        else if (tabId === 'extract-image') {
            document.getElementById('extractFileImage').value = null;
            document.getElementById('extractPreviewImage').innerHTML = '';
            document.getElementById('extractPasswordImage').value = '';
            document.getElementById('extractResultImage').innerHTML = '';
        } 
        // Analyze Detect
        else if (tabId === 'analyze-detect') {
            document.getElementById('detectFileImage').value = null;
            document.getElementById('detectFilePreviewList').innerHTML = '';
            document.getElementById('detectFilePreviewList').style.display = 'none';
            document.getElementById('detectResultSummary').style.display = 'none';
            document.getElementById('detectDetailResultImage').innerHTML = '';
            document.getElementById('detectDetailResultImage').style.display = 'none';
            document.getElementById('detectSummaryTableBody').innerHTML = '';
            document.getElementById('detectSensitivity').value = '250'; // Reset to new default
            document.getElementById('sensitivityLabel').textContent = 'Default (2.50)'; // Reset to new default
            this.analysisCache.clear();
        } 
        // Analyze Evaluate
        else if (tabId === 'analyze-evaluate') {
            document.getElementById('evalCoverFileImage').value = null;
            document.getElementById('evalStegoFileImage').value = null;
            document.getElementById('evalResultImage').innerHTML = '';
            document.getElementById('evalCoverUploadImage').innerHTML = `<input type="file" id="evalCoverFileImage" accept="image/*" style="display: none;"><div class="upload-icon"><i data-lucide="file-image"></i></div><p>Original image</p>`;
            document.getElementById('evalStegoUploadImage').innerHTML = `<input type="file" id="evalStegoFileImage" accept="image/*" style="display: none;"><div class="upload-icon"><i data-lucide="file-lock"></i></div><p>Stego image</p>`;
            try { lucide.createIcons(); } catch(e) {}
        }
        // Audio Embed
        else if (tabId === 'embed-audio') {
            document.getElementById('embedFileAudio').value = null;
            document.getElementById('embedPreviewAudio').innerHTML = '';
            document.getElementById('embedPreviewAudio').style.display = 'none';
            document.getElementById('embedMessageAudio').value = '';
            document.getElementById('embedPasswordAudio').value = '';
            document.getElementById('embedResultAudio').innerHTML = '';
            document.getElementById('embedBitDepthAudio').value = '1'; 
            document.getElementById('embedCompressionAudio').checked = true;
        } 
        // Audio Extract
        else if (tabId === 'audio-extract') {
            document.getElementById('extractFileAudio').value = null;
            document.getElementById('extractPreviewAudio').innerHTML = '';
            document.getElementById('extractPreviewAudio').style.display = 'none';
            document.getElementById('extractPasswordAudio').value = '';
            document.getElementById('extractResultAudio').innerHTML = '';
        }
        this.hideAlert();
    }
    
    imageToCanvas(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const reader = new FileReader();
            reader.onload = (e) => {
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    resolve(canvas);
                };
                img.onerror = (err) => reject(new Error('Image could not be loaded. It may be corrupt.'));
                img.src = e.target.result; 
            };
            reader.onerror = (err) => reject(new Error('File could not be read.'));
            reader.readAsDataURL(file);
        });
    }
    
    showAlert(message, type) {
        const alert = document.getElementById('alert');
        alert.className = `alert alert-${type} show`;
        alert.textContent = message;
        alert.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Don't auto-hide warnings
        if(type !== 'warning') {
            setTimeout(() => this.hideAlert(), 5000);
        }
    }
    
    hideAlert() {
        const alert = document.getElementById('alert');
        alert.classList.remove('show');
    }
    
    showLoading(id) {
        document.getElementById(id).classList.add('active');
    }
    
    hideLoading(id) {
        document.getElementById(id).classList.remove('active');
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Wait until the document is fully loaded to create the controller
document.addEventListener('DOMContentLoaded', () => {
    uiController = new UIController();
});