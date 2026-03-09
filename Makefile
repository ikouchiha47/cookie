.PHONY: apk server clean

OUTPUT_DIR := outputs
APK_SRC    := mobile/android/app/build/outputs/apk/debug/app-debug.apk
APK_DST    := $(OUTPUT_DIR)/cookie.apk

apk:
	cd mobile && npx expo run:android --no-install
	mkdir -p $(OUTPUT_DIR)
	cp $(APK_SRC) $(APK_DST)
	@echo "APK ready: $(APK_DST)"

server:
	uv run cookie-server

clean:
	rm -rf $(OUTPUT_DIR)
	cd mobile/android && ./gradlew clean


rebuild_android:
	cd mobile
	rm -rf android/app/build
	rm -rf android/.gradle
	rm -rf node_modules/.cache
	npx expo run:android
