import { Request } from "express";
import { StorageEngine } from "multer";

// ─── Cloudinary Result ────────────────────────────────────────────────────────

export interface CloudinaryUploadResult {
  public_id: string;
  version: number;
  signature: string;
  width?: number;
  height?: number;
  format: string;
  resource_type: string;
  created_at: string;
  tags: string[];
  bytes: number;
  type: string;
  etag: string;
  placeholder?: boolean;
  url: string;
  secure_url: string;
  folder?: string;
  original_filename?: string;
  [key: string]: unknown;
}

// ─── Extended Multer File ─────────────────────────────────────────────────────

export interface CloudinaryFile extends Express.Multer.File {
  /** Cloudinary secure URL – same as `secure_url` */
  path: string;
  /** Cloudinary public_id – same as `public_id` */
  filename: string;
  /** Cloudinary public_id */
  public_id: string;
  /** HTTPS delivery URL */
  secure_url: string;
  /** HTTP delivery URL */
  url: string;
  /** 'image' | 'video' | 'raw' */
  resource_type: string;
  /** File extension / format (e.g. 'jpg', 'png') */
  format: string;
  /** Width in pixels (images/videos) */
  width?: number;
  /** Height in pixels (images/videos) */
  height?: number;
  /** File size in bytes */
  bytes: number;
  /** ETag returned by Cloudinary */
  etag: string;
  /** ISO timestamp of the upload */
  created_at: string;
  /** Folder path on Cloudinary (if set) */
  folder?: string;
  /** Full raw Cloudinary upload result */
  cloudinary: CloudinaryUploadResult;
}

// ─── Params ───────────────────────────────────────────────────────────────────

/**
 * A value that can be supplied either statically or as an async factory.
 */
export type ParamValue<T> =
  | T
  | ((req: Request, file: Express.Multer.File) => T | Promise<T>);

/**
 * The full set of upload parameters that can be passed to CloudinaryStorage.
 * Any Cloudinary upload API parameter is accepted; the most common are listed.
 */
export interface CloudinaryStorageParams {
  /** Cloudinary folder to upload into */
  folder?: ParamValue<string>;
  /**
   * Public ID for the asset. Should be provided as a function to guarantee
   * uniqueness, otherwise Cloudinary will overwrite assets with the same id.
   */
  public_id?: ParamValue<string>;
  /** Output format, e.g. 'jpg', 'png', 'webp', 'mp4' */
  format?: ParamValue<string>;
  /** 'image' | 'video' | 'raw' | 'auto' (default: 'auto') */
  resource_type?: ParamValue<"image" | "video" | "raw" | "auto">;
  /** Eager transformation(s) */
  transformation?: ParamValue<object | object[]>;
  /** Tags to attach to the asset */
  tags?: ParamValue<string[]>;
  /** Whether Cloudinary should use the original filename */
  use_filename?: ParamValue<boolean>;
  /** Whether to append a random suffix to guarantee uniqueness */
  unique_filename?: ParamValue<boolean>;
  /** Overwrite an existing asset with the same public_id */
  overwrite?: ParamValue<boolean>;
  /** Any other Cloudinary upload parameter */
  [key: string]: ParamValue<unknown> | undefined;
}

// ─── Options ─────────────────────────────────────────────────────────────────

export interface CloudinaryStorageOptions {
  /**
   * A configured cloudinary v2 API object.
   *
   * Always use `.v2` regardless of SDK version — it works correctly for both:
   * - cloudinary SDK v1.x: `require('cloudinary').v2`
   * - cloudinary SDK v2.x: `require('cloudinary').v2`  ← same, NOT top-level
   *
   * Despite cloudinary v2 docs, `require('cloudinary')` (top-level) does not
   * reliably expose `uploader.upload_stream` and should not be used here.
   */
  cloudinary: {
    uploader: {
      upload_stream: (
        options: object,
        callback: (error: Error | null, result: CloudinaryUploadResult) => void,
      ) => NodeJS.WritableStream;
      destroy: (publicId: string, options?: object) => Promise<object>;
    };
    [key: string]: unknown;
  };

  /**
   * Upload parameters – either a static object, an object where each key
   * can be a function, or a single async function returning the full params.
   *
   * @example
   * // Static object
   * params: { folder: 'uploads', format: 'webp' }
   *
   * @example
   * // Per-key functions (most flexible)
   * params: {
   *   folder: (req, file) => `users/${req.user.id}`,
   *   public_id: (req, file) => `${Date.now()}-${file.originalname}`,
   *   format: async (req, file) => 'webp',
   * }
   *
   * @example
   * // Single async function returning full params object
   * params: async (req, file) => ({
   *   folder: `users/${req.user.id}`,
   *   public_id: Date.now().toString(),
   * })
   */
  params?:
    | CloudinaryStorageParams
    | ((
        req: Request,
        file: Express.Multer.File,
      ) => CloudinaryStorageParams | Promise<CloudinaryStorageParams>);
}

// ─── CloudinaryStorage ────────────────────────────────────────────────────────

/**
 * Multer storage engine for Cloudinary.
 *
 * Compatible with:
 * - `cloudinary` SDK v1.x  → pass `require('cloudinary').v2`
 * - `cloudinary` SDK v2.x  → pass `require('cloudinary').v2`  (same — NOT top-level)
 *
 * @example
 * ```ts
 * import { CloudinaryStorage } from 'multer-storage-cloudinary-v2';
 * import { v2 as cloudinary } from 'cloudinary'; // works for both v1 and v2 SDK
 *
 * const storage = new CloudinaryStorage({
 *   cloudinary,
 *   params: {
 *     folder: 'uploads',
 *     format: async (req, file) => 'webp',
 *     public_id: (req, file) => `${Date.now()}-${file.originalname}`,
 *   },
 * });
 * ```
 */
export declare class CloudinaryStorage implements StorageEngine {
  constructor(opts: CloudinaryStorageOptions);

  _handleFile(
    req: Request,
    file: Express.Multer.File,
    callback: (error?: Error | null, info?: Partial<CloudinaryFile>) => void,
  ): void;

  _removeFile(
    req: Request,
    file: Express.Multer.File & { public_id?: string; resource_type?: string },
    callback: (error: Error | null) => void,
  ): void;
}
