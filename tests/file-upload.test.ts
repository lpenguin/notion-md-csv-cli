import { describe, it, expect } from 'vitest';
import {
  isFileUrl,
  fileUrlToPath,
} from '../src/lib/file-upload.js';

describe('File Upload Utilities', () => {
  describe('isFileUrl', () => {
    it('should return true for file:// URLs', () => {
      expect(isFileUrl('file:///path/to/image.jpg')).toBe(true);
      expect(isFileUrl('file://./relative/path.png')).toBe(true);
    });

    it('should return false for non-file URLs', () => {
      expect(isFileUrl('https://example.com/image.jpg')).toBe(false);
      expect(isFileUrl('http://example.com/image.png')).toBe(false);
      expect(isFileUrl('/absolute/path.jpg')).toBe(false);
      expect(isFileUrl('./relative/path.png')).toBe(false);
    });
  });

  describe('fileUrlToPath', () => {
    it('should convert Unix file:// URL to path', () => {
      expect(fileUrlToPath('file:///home/user/image.jpg')).toBe('/home/user/image.jpg');
      expect(fileUrlToPath('file:///tmp/test.png')).toBe('/tmp/test.png');
    });

    it('should convert Windows file:// URL to path', () => {
      expect(fileUrlToPath('file:///C:/Users/test/image.jpg')).toBe('C:/Users/test/image.jpg');
      expect(fileUrlToPath('file:///D:/data/test.png')).toBe('D:/data/test.png');
    });

    it('should decode URL encoding', () => {
      expect(fileUrlToPath('file:///path/with%20spaces/image.jpg')).toBe('/path/with spaces/image.jpg');
      expect(fileUrlToPath('file:///path/%E2%9C%93/test.png')).toBe('/path/✓/test.png');
    });

    it('should return non-file URLs unchanged', () => {
      const url = 'https://example.com/image.jpg';
      expect(fileUrlToPath(url)).toBe(url);
    });
  });
});
