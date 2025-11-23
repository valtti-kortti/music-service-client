package main

import (
	"embed"
	"os"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {

	baseUrl := os.Getenv("WAILS_API_BASE_URL")
	if baseUrl == "" {
		baseUrl = "http://localhost:8080"
	}

	// Create an instance of the app structure
	app := NewApp(baseUrl)

	// Create application with options
	err := wails.Run(&options.App{
		Title:     "Music Room",
		Width:     900,
		Height:    600,
		MinWidth:  900,
		MinHeight: 600,
		MaxWidth:  900,
		MaxHeight: 600,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        app.startup,
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
