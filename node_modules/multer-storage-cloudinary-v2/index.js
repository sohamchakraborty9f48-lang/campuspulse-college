"use strict";

/**
 * multer-storage-cloudinary-v2
 *
 * A Cloudinary multer storage engine that works with:
 *  - cloudinary SDK v1.x  (pass `require('cloudinary').v2`)
 *  - cloudinary SDK v2.x  (pass `require('cloudinary')` directly)
 *
 * The engine auto-detects which SDK shape is provided.
 */

const { PassThrough } = require("stream");

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolve a value that may be:
 *   - a plain value          → returned as-is
 *   - a sync function        → called with (req, file) and result returned
 *   - an async function      → awaited and result returned
 *
 * @param {*} value
 * @param {import('express').Request} req
 * @param {Express.Multer.File} file
 * @returns {Promise<*>}
 */
async function resolve(value, req, file) {
  if (typeof value === "function") {
    return value(req, file);
  }
  return value;
}

/**
 * Normalise the cloudinary instance.
 *
 * Both cloudinary v1.x and v2.x expose the modern API under `.v2`.
 * Despite what the cloudinary v2 docs suggest, `require('cloudinary')` at
 * the top level does NOT reliably expose `uploader.upload_stream` — only
 * `require('cloudinary').v2` does, consistently across both SDK versions.
 *
 * Resolution order:
 *   1. If `.v2` sub-key exists and has `upload_stream` → use it (covers
 *      both v1 root import and v2 top-level import).
 *   2. If the instance itself has `upload_stream` → use it directly
 *      (covers the case where the caller already passed `.v2`).
 *   3. Otherwise throw a clear error.
 *
 * @param {object} cloudinaryInstance
 * @returns {{ uploader: object }}
 */
function normaliseCloudinary(cloudinaryInstance) {
  if (!cloudinaryInstance) {
    throw new Error(
      "[multer-storage-cloudinary-v2] A cloudinary instance is required. " +
        'Always pass `require("cloudinary").v2` regardless of SDK version.',
    );
  }

  // Preferred: caller already passed `.v2` directly (recommended usage).
  if (
    cloudinaryInstance.uploader &&
    typeof cloudinaryInstance.uploader.upload_stream === "function"
  ) {
    return cloudinaryInstance;
  }

  // Fallback: caller passed the root cloudinary object (either v1 or v2).
  // Both SDKs expose the correct API under `.v2`, so unwrap it automatically.
  if (
    cloudinaryInstance.v2 &&
    cloudinaryInstance.v2.uploader &&
    typeof cloudinaryInstance.v2.uploader.upload_stream === "function"
  ) {
    console.warn(
      "[multer-storage-cloudinary-v2] You passed the root cloudinary object. " +
        "Automatically using `.v2`. For best results always pass " +
        '`require("cloudinary").v2` explicitly — this works for both v1 and v2 SDKs.',
    );
    return cloudinaryInstance.v2;
  }

  throw new Error(
    "[multer-storage-cloudinary-v2] The provided cloudinary instance does " +
      "not expose `uploader.upload_stream`.\n" +
      '  Use: `require("cloudinary").v2`  (works for both cloudinary v1 and v2 SDKs)',
  );
}

/**
 * Build the upload options object from resolved params.
 * Strips `format` from the upload options and converts it to
 * `allowed_formats` / appended to public_id when needed.
 *
 * @param {object} rawParams
 * @returns {{ uploadOptions: object, format: string|undefined }}
 */
function buildUploadOptions(rawParams) {
  const { format, ...rest } = rawParams;
  const uploadOptions = { ...rest };

  // Cloudinary uses `format` as the file format / extension.
  // When provided we set it directly on the upload options so Cloudinary
  // transcodes / renames automatically.
  if (format) {
    uploadOptions.format = format;
  }

  return uploadOptions;
}

// ─── Storage Engine ──────────────────────────────────────────────────────────

class CloudinaryStorage {
  /**
   * @param {object} opts
   * @param {object} opts.cloudinary   - A cloudinary v2 API instance.
   * @param {object|Function} opts.params
   *   Either a params object (or async function returning one) with keys:
   *   - folder         {string|Function}
   *   - public_id      {Function}          (recommended to be functional)
   *   - format         {string|Function}
   *   - resource_type  {string|Function}   defaults to 'auto'
   *   - transformation {object|Function}
   *   - tags           {string[]|Function}
   *   - … any other Cloudinary upload parameter
   * @param {Function} [opts.filename]  Deprecated alias for params.public_id
   */
  constructor(opts = {}) {
    if (!opts.cloudinary) {
      throw new Error(
        "[multer-storage-cloudinary-v2] `cloudinary` option is required.",
      );
    }

    this._cloudinary = normaliseCloudinary(opts.cloudinary);
    this._params = opts.params || {};

    // Legacy support: `filename` option → treated as `public_id` param
    if (opts.filename && !opts.params?.public_id) {
      const filename = opts.filename;
      if (this._params && typeof this._params !== "function") {
        this._params = { ...this._params, public_id: filename };
      }
    }
  }

  /**
   * Resolve all params for this request.
   * Supports both "params as object" and "params as single async function".
   *
   * @param {import('express').Request} req
   * @param {Express.Multer.File} file
   * @returns {Promise<object>}
   */
  async _resolveParams(req, file) {
    // If params itself is a function → call it to get the params object
    if (typeof this._params === "function") {
      const result = await this._params(req, file);
      return result || {};
    }

    // Otherwise resolve each key individually (supports per-key functions)
    const resolved = {};
    const keys = Object.keys(this._params);

    for (const key of keys) {
      resolved[key] = await resolve(this._params[key], req, file);
    }

    return resolved;
  }

  /**
   * Multer calls _handleFile when a file is received.
   *
   * @param {import('express').Request} req
   * @param {Express.Multer.File} file
   * @param {Function} cb
   */
  _handleFile(req, file, cb) {
    this._resolveParams(req, file)
      .then((params) => {
        const uploadOptions = buildUploadOptions(params);

        // Default resource_type to 'auto' so images, videos, and raw files
        // all work without extra configuration.
        if (!uploadOptions.resource_type) {
          uploadOptions.resource_type = "auto";
        }

        // Create the Cloudinary upload stream.
        // Works identically on v1 SDK (.v2) and v2 SDK (direct).
        const uploadStream = this._cloudinary.uploader.upload_stream(
          uploadOptions,
          (error, result) => {
            if (error) {
              return cb(error);
            }

            // Expose Cloudinary result fields on the multer file object
            // (matches the shape of the original multer-storage-cloudinary).
            cb(null, {
              path: result.secure_url,
              filename: result.public_id,
              size: result.bytes,

              // Full Cloudinary result for advanced use-cases
              cloudinary: result,

              // Convenience aliases
              public_id: result.public_id,
              secure_url: result.secure_url,
              url: result.url,
              resource_type: result.resource_type,
              format: result.format,
              width: result.width,
              height: result.height,
              bytes: result.bytes,
              etag: result.etag,
              created_at: result.created_at,
              folder: result.folder,
            });
          },
        );

        // Pipe the incoming file stream into Cloudinary.
        // Use a PassThrough so we don't risk swallowing stream errors.
        const passthrough = new PassThrough();

        passthrough.on("error", (err) => {
          uploadStream.destroy(err);
          cb(err);
        });

        uploadStream.on("error", (err) => {
          cb(err);
        });

        file.stream.pipe(passthrough).pipe(uploadStream);
      })
      .catch(cb);
  }

  /**
   * Multer calls _removeFile when an upload is aborted / rolled back.
   * Deletes the file from Cloudinary using its public_id.
   *
   * @param {import('express').Request} req
   * @param {Express.Multer.File & { public_id?: string, resource_type?: string }} file
   * @param {Function} cb
   */
  _removeFile(req, file, cb) {
    if (!file.public_id) {
      return cb(null);
    }

    const options = {};
    if (file.resource_type) {
      options.resource_type = file.resource_type;
    }

    this._cloudinary.uploader
      .destroy(file.public_id, options)
      .then(() => cb(null))
      .catch(cb);
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = { CloudinaryStorage };
