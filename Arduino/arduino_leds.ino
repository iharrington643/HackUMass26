// this converts the digital simulation tumor to chained 16x16 WS2812B panels for a physical demo
//
// the browser does all the processing and work (with like picking colors, slices the sphere, handles the snake wiring) and just streams
// finished frames over USB. this sketch only receives them and pushes them to the LEDs
//
// protocol: we send 'R' + NUM_PANELS when ready. the browser answers with 'O' 'S' + NUM_LEDS*3 bytes (r,g,b).
// we only say 'R' when we're NOT busy updating LEDs, because FastLED.show() turns interrupts off and any USB
// bytes arriving during it would be lost
//
// MEMORY: each LED needs 3 bytes of RAM. Uno has 2048 bytes total -> 2 panels max (1536 bytes).
//         Arduino Mega has 8192 -> all 5 panels fine. ESP32 also fine (note to come back to later: arduino is 3.3V and the LEDs are 5V, 
// do we need a level shifter??)

#include <FastLED.h>

#define DATA_PIN    6
#define NUM_PANELS  2          
#define LEDS_PER_PANEL 256
#define NUM_LEDS    (NUM_PANELS * LEDS_PER_PANEL)
#define BRIGHTNESS  60          
#define BAUD        1000000      // NOTE IMPORTAT NOTE this has to match BAUD in web/ledlink.js. if frames glitch drop both to 500000 

CRGB leds[NUM_LEDS];
unsigned long lastReady = 0;

void sayReady() {
  Serial.write('R');
  Serial.write((uint8_t)NUM_PANELS);
  lastReady = millis();
}

int readByteWithin(unsigned long ms) {
  unsigned long t = millis();
  while (!Serial.available()) if (millis() - t > ms) return -1;
  return Serial.read();
}

void setup() {
  FastLED.addLeds<WS2812B, DATA_PIN, GRB>(leds, NUM_LEDS);
  FastLED.setBrightness(BRIGHTNESS);
  FastLED.setMaxPowerInVoltsAndMilliamps(5, 8000UL * NUM_PANELS); 

  // a color control test
  // panel 1 red, panel 2 green, panel 3 blue, panel 4 yellow, panel 5 purple
  const CRGB test[] = { CRGB::Red, CRGB::Green, CRGB::Blue, CRGB::Yellow, CRGB::Purple };
  for (int p = 0; p < NUM_PANELS; p++) fill_solid(leds + p * LEDS_PER_PANEL, LEDS_PER_PANEL, test[p % 5]);
  FastLED.setBrightness(20);
  FastLED.show();
  delay(1200);
  FastLED.setBrightness(BRIGHTNESS);
  FastLED.clear(true);

  Serial.begin(BAUD);
  Serial.setTimeout(200);
  sayReady();
}

void loop() {
  if (Serial.available()) {
    if (Serial.read() != 'O') return;                 
    if (readByteWithin(20) != 'S') return;
    size_t got = Serial.readBytes((char*)leds, NUM_LEDS * 3);   
    if (got == NUM_LEDS * 3) FastLED.show();         
    sayReady();
  } else if (millis() - lastReady > 500) {
    sayReady();                                     
  }
}
