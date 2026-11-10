// GPU ballast of the render bench (P0-016). A constant, tunable load in its own offscreen viewport, so the frame is
// GPU bound and longer than the display's 8.33 ms refresh. Without it macOS caps the game at 120 fps even with vsync
// off and the Apple GPU clocks down to fill the frame: every light scene then reads about 6.5 ms of GPU time. With
// the GPU kept busy it runs at full clock and the root viewport's own GPU time is the real cost of the scene.
shader_type canvas_item;

uniform int iterations = 100;

void fragment() {
	vec2 p = UV * 8.0;
	float a = 0.0;
	for (int i = 0; i < iterations; i++) {
		p = vec2(sin(p.x * 1.3 + p.y), cos(p.y * 1.7 - p.x)) * 2.0 + a;
		a += fract(p.x * p.y) * 0.001;
	}
	COLOR = vec4(fract(a), 0.0, 0.0, 1.0);
}
