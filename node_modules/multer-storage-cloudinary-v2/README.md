# multer-storage-cloudinary-v2

[![npm version](https://img.shields.io/npm/v/multer-storage-cloudinary-v2)](https://www.npmjs.com/package/multer-storage-cloudinary-v2)
[![license](https://img.shields.io/npm/l/multer-storage-cloudinary-v2)](./LICENSE)

**A modern, actively maintained drop-in replacement** for the original [`multer-storage-cloudinary`](https://github.com/affanshahid/multer-storage-cloudinary) that adds **full native support** for both the legacy and modern Cloudinary Node.js SDKs.

| Cloudinary SDK       | How you import              | Supported |
|----------------------|-----------------------------|-----------|
| `cloudinary@^1.21.0` | `require('cloudinary').v2` | ✅        |
| `cloudinary@^2.x`    | `require('cloudinary').v2` | ✅        |

> **Always use `require('cloudinary').v2`** regardless of SDK version.
> Despite what the cloudinary v2 docs suggest, `require('cloudinary')` (top-level)
> does **not** reliably expose `uploader.upload_stream`. The `.v2` sub-module
> exists and works correctly in both v1 and v2 SDKs — it is the safe, universal import.

The original package was written for Cloudinary v1 and breaks when you upgrade to v2. This library handles both SDK versions with zero breaking changes to the public API.

---

## Why this package?

- Transparent support for the latest `cloudinary@^2.x` SDK
- 100% backward compatible with the original `multer-storage-cloudinary` API
- Safer stream handling with `PassThrough` buffer
- Excellent TypeScript definitions (including `CloudinaryFile` type)
- Flexible `params` system (static, per-key functions, or single async function)
- Helpful warnings and clear error messages
- Actively maintained and well-tested
---

## Installation

```bash
npm install multer-storage-cloudinary-v2
```

`multer` and `cloudinary` are peer dependencies — install whichever version you need:

```bash
# latest cloudinary SDK
npm install cloudinary multer

# OR lock to the legacy SDK
npm install cloudinary@^1.21.0 multer
```

---

## Usage

### With `cloudinary@^2.x` (modern SDK)

```js
const cloudinary = require('cloudinary').v2;  // ✅ always use .v2, even with v2 SDK
const { CloudinaryStorage } = require('multer-storage-cloudinary-v2');
const multer = require('multer');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary,          // pass .v2 — works for both v1 and v2 SDKs
  params: {
    folder: 'uploads',
    format: async (req, file) => 'webp',
    public_id: (req, file) => `${Date.now()}-${file.originalname}`,
  },
});

const upload = multer({ storage });

// In your Express app
app.post('/upload', upload.single('image'), (req, res) => {
  res.json(req.file);
});
```

### With `cloudinary@^1.21.0` (legacy SDK)

```js
const cloudinary = require('cloudinary').v2;   // v1 SDK — use the .v2 sub-module
const { CloudinaryStorage } = require('multer-storage-cloudinary-v2');
const multer = require('multer');

cloudinary.config({ /* ... */ });

const storage = new CloudinaryStorage({
  cloudinary,          // pass .v2 exactly as before
  params: {
    folder: 'uploads',
    public_id: (req, file) => `img-${Date.now()}`,
  },
});
```

### TypeScript

```ts
import { v2 as cloudinary } from 'cloudinary';  // works for both v1 and v2 SDKs
import { CloudinaryStorage, CloudinaryFile } from 'multer-storage-cloudinary-v2';
import multer from 'multer';

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'uploads',
    format: async (req, file) => 'webp',
    public_id: (req, file) => Date.now().toString(),
  },
});

const upload = multer({ storage });

app.post('/upload', upload.single('avatar'), (req, res) => {
  const file = req.file as CloudinaryFile;
  res.json({ url: file.secure_url, id: file.public_id });
});
```

---

## Configuration

### `new CloudinaryStorage(options)`

| Option | Type | Required | Description |
|---|---|---|---|
| `cloudinary` | `object` | ✅ | A configured Cloudinary API instance. Pass `require('cloudinary').v2` for v1 SDK or `require('cloudinary')` for v2 SDK. |
| `params` | `object \| Function` | — | Upload parameters (see below). |

### `params`

`params` can be:

1. **A static object** — values applied to every upload.
2. **An object with per-key functions** — each key's value can be an async function called with `(req, file)`.
3. **A single async function** — called with `(req, file)`, must return the full params object.

#### Supported param keys

| Key | Type | Default | Description |
|---|---|---|---|
| `folder` | `string \| Function` | — | Cloudinary folder to upload into. |
| `public_id` | `Function` | auto | Public ID for the asset. Recommended to be a function for uniqueness. |
| `format` | `string \| Function` | — | Output format: `'jpg'`, `'png'`, `'webp'`, `'mp4'`, etc. |
| `resource_type` | `string \| Function` | `'auto'` | `'image'`, `'video'`, `'raw'`, or `'auto'`. |
| `transformation` | `object \| Function` | — | Eager transformation(s) to apply. |
| `tags` | `string[] \| Function` | — | Tags to attach to the asset. |
| `use_filename` | `bool \| Function` | — | Use the original filename as the public ID. |
| `overwrite` | `bool \| Function` | — | Overwrite existing asset with same public_id. |
| `…` | any | — | Any [Cloudinary upload parameter](https://cloudinary.com/documentation/image_upload_api_reference#upload_optional_parameters). |

#### Per-key functional params example

```js
params: {
  folder: (req, file) => `users/${req.user.id}/avatars`,
  public_id: (req, file) => `${req.user.id}-${Date.now()}`,
  format: async (req, file) => {
    // transcode everything to webp for optimal delivery
    return 'webp';
  },
  transformation: [{ width: 800, crop: 'limit' }],
}
```

#### Single-function params example

```js
params: async (req, file) => {
  const category = await getCategory(req.params.id);
  return {
    folder: `products/${category}`,
    format: 'webp',
    public_id: `${category}-${Date.now()}`,
  };
},
```

---

## File object

After a successful upload, `req.file` / `req.files` will contain these additional Cloudinary fields:

| Field | Description |
|---|---|
| `path` | Alias for `secure_url` (matches multer convention) |
| `filename` | Alias for `public_id` (matches multer convention) |
| `public_id` | Cloudinary asset public ID |
| `secure_url` | HTTPS delivery URL |
| `url` | HTTP delivery URL |
| `resource_type` | `'image'`, `'video'`, or `'raw'` |
| `format` | File extension (`'jpg'`, `'png'`, …) |
| `width` | Width in pixels (images/videos) |
| `height` | Height in pixels (images/videos) |
| `bytes` | File size in bytes |
| `etag` | Cloudinary ETag |
| `created_at` | ISO upload timestamp |
| `folder` | Cloudinary folder (if set) |
| `cloudinary` | Full raw Cloudinary upload result |

---

## Migrating from `multer-storage-cloudinary`

1. Replace the package:
   ```bash
   npm uninstall multer-storage-cloudinary
   npm install multer-storage-cloudinary-v2
   ```

2. Update your import:
   ```diff
   - const { CloudinaryStorage } = require('multer-storage-cloudinary');
   + const { CloudinaryStorage } = require('multer-storage-cloudinary-v2');
   ```

3. That's it. The API is identical. ✅

---

## Running Tests

```bash
npm test
# or with coverage
npm run test:coverage
```

---

## License

MIT