'use client';

import { useState } from 'react';

interface ExifField {
  tag: string;
  value: string;
  privacy: 'high' | 'medium' | 'low';
  warning?: string;
}

// Minimal EXIF parser — reads JPEG EXIF data client-side
function readExif(buffer: ArrayBuffer): ExifField[] {
  const view = new DataView(buffer);
  const fields: ExifField[] = [];

  // Check JPEG SOI marker
  if (view.getUint16(0) !== 0xFFD8) {
    return [{ tag: 'Format', value: 'Not a JPEG file', privacy: 'low' }];
  }

  // Find APP1 (EXIF) marker
  let offset = 2;
  while (offset < view.byteLength - 2) {
    const marker = view.getUint16(offset);
    if (marker === 0xFFE1) {
      // APP1 marker found
      const length = view.getUint16(offset + 2);
      const exifData = new DataView(buffer, offset + 4, length - 2);
      parseExifData(exifData, fields);
      break;
    } else if ((marker & 0xFF00) !== 0xFF00) {
      break;
    } else {
      const segLen = view.getUint16(offset + 2);
      offset += 2 + segLen;
    }
  }

  if (fields.length === 0) {
    fields.push({ tag: 'Status', value: 'No EXIF data found in this image', privacy: 'low' });
  }

  return fields;
}

function parseExifData(data: DataView, fields: ExifField[]) {
  // Check "Exif\0\0" header
  if (data.byteLength < 6) return;
  const exifHeader = String.fromCharCode(data.getUint8(0), data.getUint8(1), data.getUint8(2), data.getUint8(3));
  if (exifHeader !== 'Exif') return;

  // TIFF header starts at offset 6
  const tiffOffset = 6;
  if (data.byteLength < tiffOffset + 8) return;

  const byteOrder = data.getUint16(tiffOffset);
  const littleEndian = byteOrder === 0x4949; // 'II'

  const get16 = (off: number) => data.getUint16(tiffOffset + off, littleEndian);
  const get32 = (off: number) => data.getUint32(tiffOffset + off, littleEndian);

  // Read IFD0
  const ifdOffset = get32(4);
  if (tiffOffset + ifdOffset + 2 > data.byteLength) return;
  const numEntries = get16(ifdOffset);

  const tagNames: Record<number, { name: string; privacy: ExifField['privacy']; warning?: string }> = {
    0x010F: { name: 'Camera Make', privacy: 'medium' },
    0x0110: { name: 'Camera Model', privacy: 'medium', warning: 'Reveals your device model' },
    0x0112: { name: 'Orientation', privacy: 'low' },
    0x011A: { name: 'X Resolution', privacy: 'low' },
    0x011B: { name: 'Y Resolution', privacy: 'low' },
    0x0131: { name: 'Software', privacy: 'medium', warning: 'Reveals editing software used' },
    0x0132: { name: 'Date/Time', privacy: 'high', warning: 'Shows when the photo was taken' },
    0x013B: { name: 'Artist', privacy: 'high', warning: 'May contain your name' },
    0x8298: { name: 'Copyright', privacy: 'medium' },
    0x8769: { name: 'Exif IFD Pointer', privacy: 'low' },
    0x8825: { name: 'GPS IFD Pointer', privacy: 'high', warning: 'GPS data present — location may be embedded!' },
    0xA420: { name: 'Image Unique ID', privacy: 'high', warning: 'Unique identifier that can track this image' },
  };

  for (let i = 0; i < numEntries && i < 50; i++) {
    const entryOffset = ifdOffset + 2 + (i * 12);
    if (tiffOffset + entryOffset + 12 > data.byteLength) break;

    const tag = get16(entryOffset);
    const type = get16(entryOffset + 2);
    const count = get32(entryOffset + 4);

    const tagInfo = tagNames[tag];
    if (!tagInfo) continue;

    let value = '';

    // Read ASCII string
    if (type === 2) {
      const valueOffset = count > 4 ? get32(entryOffset + 8) : entryOffset + 8;
      const chars: string[] = [];
      for (let j = 0; j < Math.min(count - 1, 100); j++) {
        if (tiffOffset + valueOffset + j >= data.byteLength) break;
        const c = data.getUint8(tiffOffset + valueOffset + j);
        if (c === 0) break;
        chars.push(String.fromCharCode(c));
      }
      value = chars.join('');
    } else if (type === 3) {
      // SHORT
      value = get16(entryOffset + 8).toString();
    } else if (type === 4) {
      // LONG
      value = get32(entryOffset + 8).toString();
    } else {
      value = `[${tagInfo.name} data present]`;
    }

    if (value && tagInfo.name !== 'Exif IFD Pointer') {
      fields.push({
        tag: tagInfo.name,
        value: tagInfo.name === 'GPS IFD Pointer' ? 'GPS coordinates embedded' : value,
        privacy: tagInfo.privacy,
        warning: tagInfo.warning,
      });
    }
  }
}

function getPrivacyColor(privacy: string) {
  switch (privacy) {
    case 'high': return 'text-red-400 border-red-500/20';
    case 'medium': return 'text-yellow-400 border-yellow-500/20';
    default: return 'text-green-400 border-green-500/20';
  }
}

export function MetadataViewerTool() {
  const [fields, setFields] = useState<ExifField[]>([]);
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState(0);
  const [scanned, setScanned] = useState(false);
  const [imagePreview, setImagePreview] = useState('');

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setFileSize(file.size);

    // Preview
    const url = URL.createObjectURL(file);
    setImagePreview(url);

    // Read EXIF
    const buffer = await file.arrayBuffer();
    const exifFields = readExif(buffer);

    // Add file-level metadata
    const allFields: ExifField[] = [
      { tag: 'File Name', value: file.name, privacy: 'medium', warning: 'File names can reveal info about content or creator' },
      { tag: 'File Size', value: `${(file.size / 1024).toFixed(1)} KB`, privacy: 'low' },
      { tag: 'MIME Type', value: file.type, privacy: 'low' },
      { tag: 'Last Modified', value: new Date(file.lastModified).toLocaleString(), privacy: 'medium', warning: 'Shows when the file was last saved' },
      ...exifFields,
    ];

    setFields(allFields);
    setScanned(true);
  };

  const highRisk = fields.filter(f => f.privacy === 'high');
  const medRisk = fields.filter(f => f.privacy === 'medium');

  return (
    <div className="space-y-6">
      <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-6">
        <label className="block text-sm font-medium text-[#B8B8D4] mb-3">Upload an image to inspect its metadata</label>
        <input
          type="file"
          accept="image/*"
          onChange={handleFile}
          className="w-full text-sm text-[#B8B8D4] file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-white/10 file:text-white hover:file:bg-white/20"
        />
        <p className="mt-2 text-xs text-[#B8B8D4]/60">
          The image is processed entirely in your browser. Nothing is uploaded to any server.
        </p>
      </div>

      {scanned && (
        <>
          {/* Preview + summary */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {imagePreview && (
              <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-4">
                <img
                  src={imagePreview}
                  alt="Uploaded preview"
                  className="w-full h-48 object-contain rounded"
                />
              </div>
            )}
            <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-white mb-3">Privacy Risk Summary</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[#B8B8D4]">High Risk Fields</span>
                  <span className={`text-sm font-bold ${highRisk.length > 0 ? 'text-red-400' : 'text-green-400'}`}>
                    {highRisk.length}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[#B8B8D4]">Medium Risk Fields</span>
                  <span className={`text-sm font-bold ${medRisk.length > 0 ? 'text-yellow-400' : 'text-green-400'}`}>
                    {medRisk.length}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[#B8B8D4]">Total Fields</span>
                  <span className="text-sm font-bold text-white">{fields.length}</span>
                </div>
              </div>
              {highRisk.length > 0 && (
                <div className="mt-3 p-3 bg-red-500/10 rounded text-xs text-red-400">
                  This image contains sensitive metadata that could reveal your identity or location.
                  Strip metadata before sharing online.
                </div>
              )}
            </div>
          </div>

          {/* All fields */}
          <div className="space-y-2">
            {fields.map((f, i) => (
              <div key={i} className={`bg-[#0a0a0a] border ${getPrivacyColor(f.privacy).split(' ')[1]} rounded-lg p-4`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-white">{f.tag}</span>
                  <span className={`text-xs ${getPrivacyColor(f.privacy).split(' ')[0]}`}>
                    {f.privacy} risk
                  </span>
                </div>
                <code className="block text-sm text-[#B8B8D4] font-mono">{f.value}</code>
                {f.warning && (
                  <p className="mt-1 text-xs text-yellow-400/80">{f.warning}</p>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
