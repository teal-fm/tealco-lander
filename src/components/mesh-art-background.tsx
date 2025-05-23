import { Link, createFileRoute } from "@tanstack/react-router";

import React, { useRef, useMemo, useEffect, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, useTexture, useFBO } from "@react-three/drei";
import * as THREE from "three";

// Vertex shader for the twist effect with geometry rotation
const vertexShader = `
  uniform float uTime;
  uniform float uRotationSpeed;
  uniform float uLayerOffset;
  varying vec2 vUv;

  void main() {
    vUv = uv;

    // Rotate geometry based on time and layer
    float angle = uTime * uRotationSpeed + uLayerOffset;
    float cos_angle = cos(angle);
    float sin_angle = sin(angle);

    // Apply rotation to vertex position
    vec3 rotatedPosition = vec3(
      position.x * cos_angle - position.y * sin_angle,
      position.x * sin_angle + position.y * cos_angle,
      position.z
    );

    gl_Position = projectionMatrix * modelViewMatrix * vec4(rotatedPosition, 1.0);
  }
`;

// Fragment shader with twist distortion and bokeh blur
const fragmentShader = `
  uniform sampler2D uTexture;
  uniform float uTime;
  uniform vec2 uTwistCenter;
  uniform float uTwistRadius;
  uniform float uTwistStrength;
  uniform float uLayerOffset;
  uniform vec3 uTint;
  uniform float uOpacity;

  uniform float uBlurRadius;
  uniform float uSamples;
  uniform vec2 uResolution; // Canvas resolution in pixels
  uniform float uLayerIndex; // Which layer this is

  varying vec2 vUv;

  // Helper function for the twist effect
  vec2 twist(vec2 uv, vec2 center, float radius, float strength) {
    vec2 offset = uv - center;
    float distance = length(offset);

    if (distance < radius) {
      float ratio = distance / radius;
      float angle = strength * (1.0 - ratio * ratio);

      float cos_angle = cos(angle);
      float sin_angle = sin(angle);

      mat2 rotation = mat2(cos_angle, -sin_angle, sin_angle, cos_angle);
      offset = rotation * offset;
    }

    return center + offset;
  }

  // Fast box blur - much cheaper than bokeh
  vec3 boxBlur(sampler2D samp, vec2 uv, float radius) {
    vec3 col = vec3(0);
    vec2 pix = 1.0 / uResolution.xy;
    float blurSize = radius * 0.5; // Scale down for subtlety

    // Simple 3x3 box blur
    for(float x = -1.0; x <= 1.0; x += 1.0) {
      for(float y = -1.0; y <= 1.0; y += 1.0) {
        vec2 offset = vec2(x, y) * pix * blurSize;
        col += texture2D(samp, uv + offset).rgb;
      }
    }
    return col / 9.0; // Average of 9 samples
  }

  // Bokeh blur function - only for final layer
  const float pi = 3.14159265359;
  const float ang = (3.0 - sqrt(5.0)) * pi;

  vec3 bokeh(sampler2D samp, vec2 uv, float radius, float samples) {
    vec3 col = vec3(0);
    vec2 pix = 1.0 / uResolution.xy;
    vec2 radiusPixels = radius * pix;

    if (samples <= 0.0 || radius <= 0.0) {
        return texture2D(samp, uv).rgb;
    }

    // Reduced max iterations for performance
    for(float i = 0.0; i < 30.0; i++){ // Much smaller loop
        if (i >= samples) break;

        float d = i / samples;
        vec2 p = vec2(sin(ang * i), cos(ang * i)) * sqrt(d) * radiusPixels;
        col += texture2D(samp, uv + p).rgb;
    }
    return col / samples;
  }

  void main() {
    // Calculate the center of the twist effect, animating it over time
    vec2 twistCenter = uTwistCenter + vec2(
      sin(uTime * 0.5 + uLayerOffset) * 0.1,
      cos(uTime * 0.3 + uLayerOffset) * 0.1
    );

    // Animate the twist strength over time
    float dynamicStrength = uTwistStrength * (1.0 + sin(uTime * 0.8 + uLayerOffset) * 0.3);
    // Apply the twist distortion to the UV coordinates
    vec2 twistedUv = twist(vUv, twistCenter, uTwistRadius, dynamicStrength);

    // Apply stacked blur based on layer
    vec3 blurredColor;

    if (uLayerIndex >= 2.0) {
      // Final layer: use bokeh blur
      blurredColor = bokeh(uTexture, twistedUv, uBlurRadius, uSamples);
    } else if (uLayerIndex >= 0.0) {
      // First two layers: use fast box blur
      float boxBlurRadius = uBlurRadius * (uLayerIndex + 1.0) * 0.3; // Progressive blur
      blurredColor = boxBlur(uTexture, twistedUv, boxBlurRadius);
    } else {
      // No blur
      blurredColor = texture2D(uTexture, twistedUv).rgb;
    }

    vec3 finalColorRgb = blurredColor;

    // Create fluid color gradients based on position and twist
    vec2 gradientUv = vUv + sin(twistedUv * 3.14159 + uTime * 0.5) * 0.1;
    float gradient = smoothstep(0.0, 1.0, gradientUv.x + gradientUv.y * 0.5);

    // Blend between base color and tint for fluid effect
    vec3 fluidColor = mix(finalColorRgb, finalColorRgb * uTint * 1.5, gradient);

    // Add warm/cool color shifts like the reference
    vec3 warmShift = vec3(1.2, 0.9, 0.7); // Warm tones
    vec3 coolShift = vec3(0.8, 1.0, 1.3); // Cool tones
    float colorShift = sin(uTime * 0.3 + uLayerOffset) * 0.5 + 0.5;
    fluidColor *= mix(coolShift, warmShift, colorShift);

    // Use the alpha from a standard texture lookup at the twisted UV for transparency
    vec4 texColorAlpha = texture2D(uTexture, twistedUv, 0.0); // Use LOD 0

    // Set the final fragment color with fluid color blending
    gl_FragColor = vec4(fluidColor, texColorAlpha.a * uOpacity);
  }
`;

function TwistedLayer({
  texture,
  layerIndex,
  totalLayers,
  resolution,
  blurRadius,
  samples,
  numLayers,
}) {
  const meshRef = useRef();
  const materialRef = useRef();

  // Define uniforms using useMemo for performance
  const uniforms = useMemo(
    () => ({
      uTexture: { value: texture },
      uTime: { value: 0 },
      uTwistCenter: {
        value: new THREE.Vector2(layerIndex * 0.5, layerIndex * 0.5),
      },
      uTwistRadius: { value: 1.2 },
      uTwistStrength: { value: 2.5 },
      uLayerOffset: { value: layerIndex * Math.PI * 0.5 },
      uTint: { value: new THREE.Vector3(0.4, 0.4, 0.4) },
      uOpacity: { value: 0.8 },
      uRotationSpeed: { value: (layerIndex + 1) * 0.05 }, // Much slower, subtle rotation
      // Blur uniforms - stacked system
      uResolution: { value: resolution || new THREE.Vector2(1, 1) },
      uBlurRadius: { value: layerIndex === 0 ? blurRadius || 0 : 0 },
      uSamples: { value: layerIndex === 0 ? samples || 0 : 0 },
    }),
    // Include all dependencies that affect initial uniform values
    [layerIndex, texture, resolution, blurRadius, samples],
  );

  // Update uniforms when props change (especially texture, resolution, blurRadius, samples)
  useEffect(() => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTexture.value = texture;
      materialRef.current.uniforms.uResolution.value =
        resolution || new THREE.Vector2(1, 1);
      // Only apply blur to the top layer (layerIndex 0)
      materialRef.current.uniforms.uBlurRadius.value =
        layerIndex === 0 ? blurRadius || 0 : 0;
      materialRef.current.uniforms.uSamples.value =
        layerIndex === 0 ? samples || 0 : 0;
      materialRef.current.needsUpdate = true; // Important to signal changes
      console.log(
        `Layer ${layerIndex}: Updated uniforms - blurRadius: ${layerIndex === 0 ? blurRadius : 0}, samples: ${layerIndex === 0 ? samples : 0}, resolution: ${resolution?.x}x${resolution?.y}`,
      );
    }
  }, [materialRef, texture, resolution, blurRadius, samples, layerIndex]); // Depend on relevant props

  // Different tint for each layer to create fluid color blending
  useEffect(() => {
    if (materialRef.current) {
      const isBackground = layerIndex === totalLayers - 1;
      materialRef.current.needsUpdate = true;
    }
  }, [layerIndex, totalLayers, materialRef]);

  useFrame((state) => {
    // Update time uniform for animation
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;

      // More fluid, warping twist - like melting forms
      const baseStrength =
        2.0 + Math.sin(state.clock.elapsedTime * 0.2 + layerIndex * 0.2) * 0.8;
      materialRef.current.uniforms.uTwistStrength.value = baseStrength;

      // Gentle, flowing twist center movement - like melting
      const centerX =
        0.5 + Math.sin(state.clock.elapsedTime * 0.1 + layerIndex * 0.3) * 0.1;
      const centerY =
        0.5 + Math.cos(state.clock.elapsedTime * 0.08 + layerIndex * 0.4) * 0.1;
      materialRef.current.uniforms.uTwistCenter.value.set(centerX, centerY);
    }

    // Different movement for background vs moving layers
    if (meshRef.current) {
      const time = state.clock.elapsedTime;
      const isBackground = layerIndex === totalLayers - 1;

      if (isBackground) {
        const speed = (layerIndex + 1) * 0.2;
        const orbitRadius = layerIndex * 3.5;
        const verticalOffset = Math.sin(time * speed * 0.7);

        // Orbital movement with vertical variation
        meshRef.current.position.x = Math.cos(time * speed) * orbitRadius;
        meshRef.current.position.y =
          Math.sin(time * speed) * orbitRadius * 0.6 + verticalOffset;
        meshRef.current.position.z = -layerIndex * 0.02;

        const breathe = 1.0 + Math.sin(time * 0.1) * 0.02;
        meshRef.current.scale.setScalar(15 * breathe);
        meshRef.current.position.set(0, 0, -layerIndex * 0.02);
        meshRef.current.rotation.z = time * speed * 0.02;
      } else {
        // Moving layers: orbit around with different speeds and paths
        const speed = (layerIndex + 1) * 0.03;
        const orbitRadius = layerIndex - 0.1 * 3.5;
        const verticalOffset = Math.sin(time * speed * 0.7) * 0.2;

        // Orbital movement with vertical variation
        meshRef.current.position.x = Math.cos(time * speed) * orbitRadius;
        meshRef.current.position.y =
          Math.sin(time * speed) * orbitRadius * 0.6 + verticalOffset;
        meshRef.current.position.z = -layerIndex * 0.02;

        // Dynamic scaling with breathing
        const breathe = 1.0 + Math.sin(time * speed * 2) * 0.1;
        const baseScale = layerIndex * 2;
        meshRef.current.scale.setScalar(baseScale * breathe);

        // Rotation for flow effect
        meshRef.current.rotation.z = time * speed * 0.2;
      }
    }
  });

  // Different behavior for background vs moving layers
  const isBackground = layerIndex === numLayers - 1; // Last layer is background
  const layerScale = isBackground ? 15 : (layerIndex + 5) * 30; // Big background, small moving layers

  return (
    <mesh ref={meshRef} position={[0, 0, -layerIndex]} scale={layerScale}>
      <planeGeometry args={isBackground ? [1, 1, 32, 32] : [1, 1, 16, 16]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent={true}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function AlbumArtVisualizer({
  imageUrl,
  fallbackTexture,
  resolution,
  blurRadius,
  samples,
  onTextureLoad, // Add onTextureLoad prop
}) {
  const [loadedTexture, setLoadedTexture] = useState(fallbackTexture);
  const [isLoading, setIsLoading] = useState(false);

  // Handle texture loading with proper error handling
  useEffect(() => {
    if (!imageUrl) {
      setLoadedTexture(fallbackTexture);
      return;
    }

    setIsLoading(true);

    const loader = new THREE.TextureLoader();
    loader.crossOrigin = "anonymous"; // Important for loading images from other domains

    loader.load(
      imageUrl,
      (texture) => {
        // Success
        texture.wrapS = THREE.RepeatWrapping; // Ensure wrapping is set
        texture.wrapT = THREE.RepeatWrapping;
        texture.minFilter = THREE.LinearMipmapLinearFilter; // Use mipmapping filter for better scaling
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = true; // Generate mipmaps

        setLoadedTexture(texture);
        setIsLoading(false);
        if (onTextureLoad) {
          // Call callback if provided
          onTextureLoad();
        }
      },
      (progress) => {
        // Progress - optional, good for loaders
        // console.log('Loading texture:', (progress.loaded / progress.total * 100) + '%');
      },
      (error) => {
        // Error - fall back to procedural texture
        console.warn("Failed to load image:", error);
        setLoadedTexture(fallbackTexture); // Use fallback on error
        setIsLoading(false);
      },
    );
  }, [imageUrl, fallbackTexture]); // Depend only on imageUrl and fallbackTexture for loading logic

  const numLayers = 5; // 1 large background + 4 smaller moving layers

  return (
    <group>
      {/* Render layers if not loading */}
      {!isLoading &&
        Array.from({ length: numLayers }, (_, i) => (
          <TwistedLayer
            key={`layer-${i}-${imageUrl || "default"}`} // Key helps React manage layers
            texture={loadedTexture}
            layerIndex={i}
            totalLayers={numLayers}
            resolution={resolution}
            blurRadius={blurRadius}
            samples={samples}
            numLayers={numLayers}
          />
        ))}
      {/* Show loading indicator mesh */}
      {isLoading && (
        <mesh>
          <planeGeometry args={[4, 4]} />
          <meshBasicMaterial color="#333" transparent opacity={0.5} />
        </mesh>
      )}
    </group>
  );
}

// Post-processing shaders
const postVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const gaussianBlurFragmentShader = `
  uniform sampler2D tDiffuse;
  uniform vec2 uResolution;
  uniform float uBlurRadius;
  varying vec2 vUv;

  void main() {
    vec3 col = vec3(0.0);
    vec2 pix = 4.0 / uResolution;
    float blurSize = uBlurRadius * 0.01;

    // Gaussian kernel weights (5x5)
    float weights[81];
    weights[0] = 0.002276;
    weights[1] = 0.003984;
    weights[2] = 0.005944;
    weights[3] = 0.007556;
    weights[4] = 0.008186;
    weights[5] = 0.007556;
    weights[6] = 0.005944;
    weights[7] = 0.003984;
    weights[8] = 0.002276;
    weights[9] = 0.003984;
    weights[10] = 0.006975;
    weights[11] = 0.010406;
    weights[12] = 0.013228;
    weights[13] = 0.014330;
    weights[14] = 0.013228;
    weights[15] = 0.010406;
    weights[16] = 0.006975;
    weights[17] = 0.003984;
    weights[18] = 0.005944;
    weights[19] = 0.010406;
    weights[20] = 0.015524;
    weights[21] = 0.019735;
    weights[22] = 0.021378;
    weights[23] = 0.019735;
    weights[24] = 0.015524;
    weights[25] = 0.010406;
    weights[26] = 0.005944;
    weights[27] = 0.007556;
    weights[28] = 0.013228;
    weights[29] = 0.019735;
    weights[30] = 0.025088;
    weights[31] = 0.027177;
    weights[32] = 0.025088;
    weights[33] = 0.019735;
    weights[34] = 0.013228;
    weights[35] = 0.007556;
    weights[36] = 0.008186;
    weights[37] = 0.014330;
    weights[38] = 0.021378;
    weights[39] = 0.027177;
    weights[40] = 0.029440;
    weights[41] = 0.027177;
    weights[42] = 0.021378;
    weights[43] = 0.014330;
    weights[44] = 0.008186;
    weights[45] = 0.007556;
    weights[46] = 0.013228;
    weights[47] = 0.019735;
    weights[48] = 0.025088;
    weights[49] = 0.027177;
    weights[50] = 0.025088;
    weights[51] = 0.019735;
    weights[52] = 0.013228;
    weights[53] = 0.007556;
    weights[54] = 0.005944;
    weights[55] = 0.010406;
    weights[56] = 0.015524;
    weights[57] = 0.019735;
    weights[58] = 0.021378;
    weights[59] = 0.019735;
    weights[60] = 0.015524;
    weights[61] = 0.010406;
    weights[62] = 0.005944;
    weights[63] = 0.003984;
    weights[64] = 0.006975;
    weights[65] = 0.010406;
    weights[66] = 0.013228;
    weights[67] = 0.014330;
    weights[68] = 0.013228;
    weights[69] = 0.010406;
    weights[70] = 0.006975;
    weights[71] = 0.003984;
    weights[72] = 0.002276;
    weights[73] = 0.003984;
    weights[74] = 0.005944;
    weights[75] = 0.007556;
    weights[76] = 0.008186;
    weights[77] = 0.007556;
    weights[78] = 0.005944;
    weights[79] = 0.003984;
    weights[80] = 0.002276;

    int index = 0;
    for (float x = -4.0; x <= 4.0; x++) {
      for (float y = -4.0; y <= 4.0; y++) {
        vec2 offset = vec2(x, y) * pix;
        col += texture2D(tDiffuse, vUv + offset).rgb * weights[index];
        index++;
      }
    }

    gl_FragColor = vec4(col, 1.0);
  }
`;

const bokehBlurFragmentShader = `
  uniform sampler2D tDiffuse;
  uniform vec2 uResolution;
  uniform float uBlurRadius;
  uniform float uSamples;
  varying vec2 vUv;

  const float pi = 3.14159265359;
  const float ang = (3.0 - sqrt(5.0)) * pi;

  void main() {
    vec3 col = vec3(0);
    vec2 pix = 1.0 / uResolution;
    float blurSize = uBlurRadius * 0.02; // Increased blur size

    if (uSamples <= 0.0 || uBlurRadius <= 0.0) {
      gl_FragColor = vec4(texture2D(tDiffuse, vUv).rgb, 1.0);
      return;
    }

    // Add center sample with higher weight for better bokeh quality
    col += texture2D(tDiffuse, vUv).rgb * 2.0;
    float totalWeight = 2.0;

    for(float i = 0.0; i < 100.0; i++) { // Increased max samples
      if (i >= uSamples) break;

      float d = i / uSamples;
      float radius = sqrt(d) * blurSize;
      vec2 p = vec2(sin(ang * i), cos(ang * i)) * radius;

      // Add distance-based weighting for better bokeh circles
      float weight = 1.0 - d * 0.3;
      col += texture2D(tDiffuse, vUv + p).rgb * weight;
      totalWeight += weight;
    }

    gl_FragColor = vec4(col / totalWeight, 1.0);
  }
`;

function PostProcessing({ blurRadius, samples }) {
  const { gl, size, scene, camera } = useThree();

  // Create render targets
  const sceneTarget = useFBO(size.width, size.height);
  const gaussianBlurTarget = useFBO(size.width, size.height);
  const finalBokehTarget = useFBO(size.width, size.height);

  // Create materials
  const gaussianBlurMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: postVertexShader,
        fragmentShader: gaussianBlurFragmentShader,
        uniforms: {
          tDiffuse: { value: null },
          uResolution: { value: new THREE.Vector2(size.width, size.height) },
          uBlurRadius: { value: blurRadius },
        },
      }),
    [size.width, size.height],
  );

  const bokehBlurMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: postVertexShader,
        fragmentShader: bokehBlurFragmentShader,
        uniforms: {
          tDiffuse: { value: null },
          uResolution: { value: new THREE.Vector2(size.width, size.height) },
          uBlurRadius: { value: blurRadius },
          uSamples: { value: samples },
        },
      }),
    [size.width, size.height],
  );

  const pureBokehMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: postVertexShader,
        fragmentShader: bokehBlurFragmentShader,
        uniforms: {
          tDiffuse: { value: null },
          uResolution: { value: new THREE.Vector2(size.width, size.height) },
          uBlurRadius: { value: blurRadius * 0.5 },
          uSamples: { value: Math.min(samples, 30) },
        },
      }),
    [size.width, size.height],
  );

  // Create post-processing scene
  const postScene = useMemo(() => new THREE.Scene(), []);
  const postCamera = useMemo(
    () => new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
    [],
  );
  const postGeometry = useMemo(() => new THREE.PlaneGeometry(2, 2), []);

  useFrame(() => {
    // Update uniforms
    gaussianBlurMaterial.uniforms.uBlurRadius.value = blurRadius;
    gaussianBlurMaterial.uniforms.uResolution.value.set(
      size.width,
      size.height,
    );
    bokehBlurMaterial.uniforms.uBlurRadius.value = blurRadius;
    bokehBlurMaterial.uniforms.uSamples.value = samples;
    bokehBlurMaterial.uniforms.uResolution.value.set(size.width, size.height);
    pureBokehMaterial.uniforms.uBlurRadius.value = blurRadius * 0.5;
    pureBokehMaterial.uniforms.uSamples.value = Math.min(samples, 30);
    pureBokehMaterial.uniforms.uResolution.value.set(size.width, size.height);

    if (blurRadius > 0) {
      // Step 1: Render scene to texture
      gl.setRenderTarget(sceneTarget);
      gl.render(scene, camera);

      // Step 2: Apply gaussian blur
      postScene.clear();
      gaussianBlurMaterial.uniforms.tDiffuse.value = sceneTarget.texture;
      const gaussianBlurMesh = new THREE.Mesh(
        postGeometry,
        gaussianBlurMaterial,
      );
      postScene.add(gaussianBlurMesh);

      gl.setRenderTarget(gaussianBlurTarget);
      gl.render(postScene, postCamera);

      // Step 3: Apply bokeh blur
      postScene.clear();
      bokehBlurMaterial.uniforms.tDiffuse.value = gaussianBlurTarget.texture;
      const bokehBlurMesh = new THREE.Mesh(postGeometry, bokehBlurMaterial);
      postScene.add(bokehBlurMesh);

      gl.setRenderTarget(finalBokehTarget);
      gl.render(postScene, postCamera);

      // Step 4: Apply final pure bokeh and render to screen
      postScene.clear();
      pureBokehMaterial.uniforms.tDiffuse.value = finalBokehTarget.texture;
      const pureBokehMesh = new THREE.Mesh(postGeometry, pureBokehMaterial);
      postScene.add(pureBokehMesh);

      gl.setRenderTarget(null);
      gl.render(postScene, postCamera);
    }
  }, 1);

  return null;
}

function Scene({
  imageUrl,
  fallbackTexture,
  blurRadius,
  samples,
  boxBlurRadius,
  bokehSamples,
  onTextureLoad, // Add onTextureLoad prop
}) {
  // Get camera and canvas size from useThree hook
  const { camera, size } = useThree();

  // Calculate resolution based on canvas size, re-memoize if size changes
  const resolution = useMemo(
    () => new THREE.Vector2(size.width, size.height),
    [size],
  );

  // Set initial camera position only once on mount
  useEffect(() => {
    camera.position.set(0, 0, 4);
  }, [camera]); // Depend on camera

  return (
    <>
      {/* Add ambient light to see the mesh */}
      <ambientLight intensity={0.1} />
      {/* Render the visualizer with current props */}
      <AlbumArtVisualizer
        imageUrl={imageUrl}
        fallbackTexture={fallbackTexture}
        resolution={resolution}
        blurRadius={0}
        samples={0}
        onTextureLoad={onTextureLoad}
      />
      <PostProcessing blurRadius={boxBlurRadius} samples={bokehSamples} />
    </>
  );
}

export default function MeshArtBackground({
  imageUrl = "/canvas3.jpg", // Default image URL
  blurRadius = 30, // Layer blur radius
  samples = 25, // Layer samples
  boxBlurRadius = 4, // Post-processing gaussian blur
  bokehSamples = 50, // Post-processing bokeh samples
}) {
  // State for texture loading (still needed for fade-in)
  const [isTextureLoaded, setIsTextureLoaded] = useState(false);

  // Create fallback procedural texture using useMemo to avoid recreating
  const fallbackTexture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");

    // Create a radial gradient background
    const gradient = ctx.createRadialGradient(256, 256, 0, 256, 256, 256);
    gradient.addColorStop(0, "#ff6b9d");
    gradient.addColorStop(0.3, "#c44bff");
    gradient.addColorStop(0.6, "#4b8bff");
    gradient.addColorStop(1, "#1a1a2e");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 512, 512);

    // Add some geometric patterns
    ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
    for (let i = 0; i < 20; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const radius = Math.random() * 50 + 10;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Add some lines
    ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 10; i++) {
      ctx.beginPath();
      ctx.moveTo(Math.random() * 512, Math.random() * 512);
      ctx.lineTo(Math.random() * 512, Math.random() * 512);
      ctx.stroke();
    }

    // Create Three.js texture from canvas
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping; // Ensure wrapping is set
    texture.wrapT = THREE.RepeatWrapping;
    texture.generateMipmaps = true; // Generate mipmaps
    texture.minFilter = THREE.LinearMipmapLinearFilter; // Use mipmapping filter

    return texture;
  }, []);

  // Sample images for quick testing
  const sampleImages = [
    "https://picsum.photos/512/512?random=1",
    "https://picsum.photos/512/512?random=2",
    "https://picsum.photos/512/512?random=3",
    "https://picsum.photos/512/512?random=4",
  ];

  return (
    <div className="w-full h-screen bg-black overflow-hidden absolute inset-0 -z-10">
      <Canvas
        style={{
          transition: "opacity 1s ease-in-out",
          opacity: isTextureLoaded ? 1 : 0,
        }} // Add fade-in style
        key={imageUrl} // Force re-render Canvas when image changes to re-init state/hooks
        camera={{ position: [0, 0, 4], fov: 75 }} // Initial camera settings
        gl={{
          antialias: true, // Enable anti-aliasing
          alpha: true, // Enable transparency
          powerPreference: "low-power", // Request high performance GZU
        }}
        className="absolute inset-0" // Make canvas fill the parent div
      >
        {/* Scene component containing the 3D objects and logic */}
        <Scene
          imageUrl={imageUrl}
          fallbackTexture={fallbackTexture}
          blurRadius={blurRadius}
          samples={samples}
          boxBlurRadius={boxBlurRadius}
          bokehSamples={bokehSamples}
          onTextureLoad={() => setIsTextureLoaded(true)} // Pass callback to update state
        />
      </Canvas>
    </div>
  );
}
