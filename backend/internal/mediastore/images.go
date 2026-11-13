package mediastore

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
)

// MaxPhotoPixels refuses decompression bombs: a photo's width × height must stay under this before decoding.
const MaxPhotoPixels = 40_000_000

// DecodePhoto reads a JPEG or PNG, checking its size before decoding the pixels.
func DecodePhoto(b []byte) (image.Image, string, error) {
	cfg, format, err := image.DecodeConfig(bytes.NewReader(b))
	if err != nil {
		return nil, "", errors.New("not a JPEG or PNG picture")
	}
	if format != "jpeg" && format != "png" {
		return nil, "", errors.New("only JPEG and PNG pictures are accepted")
	}
	if cfg.Width < 1 || cfg.Height < 1 || cfg.Width*cfg.Height > MaxPhotoPixels {
		return nil, "", errors.New("the picture is too large (up to 40 megapixels)")
	}
	var img image.Image
	if format == "png" {
		img, err = png.Decode(bytes.NewReader(b))
	} else {
		img, err = jpeg.Decode(bytes.NewReader(b))
	}
	if err != nil {
		return nil, "", errors.New("the picture could not be read")
	}
	return img, format, nil
}

// Fit scales img down (never up) so its long side is at most max, averaging the source pixels under each
// output pixel (a box filter: plain, and good enough for photos going down by large factors).
func Fit(img image.Image, max int) *image.RGBA {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	nw, nh := w, h
	if w >= h && w > max {
		nw, nh = max, maxInt(1, h*max/w)
	} else if h > w && h > max {
		nw, nh = maxInt(1, w*max/h), max
	}
	out := image.NewRGBA(image.Rect(0, 0, nw, nh))
	for y := 0; y < nh; y++ {
		y0, y1 := y*h/nh, maxInt((y+1)*h/nh, y*h/nh+1)
		for x := 0; x < nw; x++ {
			x0, x1 := x*w/nw, maxInt((x+1)*w/nw, x*w/nw+1)
			var r, g, bl, a, n uint64
			for sy := y0; sy < y1; sy++ {
				for sx := x0; sx < x1; sx++ {
					cr, cg, cb, ca := img.At(b.Min.X+sx, b.Min.Y+sy).RGBA()
					r, g, bl, a, n = r+uint64(cr), g+uint64(cg), bl+uint64(cb), a+uint64(ca), n+1
				}
			}
			out.SetRGBA(x, y, color.RGBA{uint8(r / n >> 8), uint8(g / n >> 8), uint8(bl / n >> 8), uint8(a / n >> 8)})
		}
	}
	return out
}

// JPEG encodes img over white (a PNG's transparency becomes white). image.RGBA is premultiplied, so over white
// is the colour plus the uncovered part.
func JPEG(w io.Writer, img *image.RGBA, quality int) error {
	flat := image.NewRGBA(img.Bounds())
	for i := 0; i < len(img.Pix); i += 4 {
		a := uint32(img.Pix[i+3])
		for c := 0; c < 3; c++ {
			flat.Pix[i+c] = uint8(min(255, uint32(img.Pix[i+c])+255-a))
		}
		flat.Pix[i+3] = 255
	}
	return jpeg.Encode(w, flat, &jpeg.Options{Quality: quality})
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
