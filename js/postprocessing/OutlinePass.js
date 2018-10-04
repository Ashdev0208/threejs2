/**
 * @author spidersharma / http://eduperiment.com/
 */

v3d.OutlinePass = function(resolution, scene, camera, selectedObjects) {

    this.renderScene = scene;
    this.renderCamera = camera;
    this.selectedObjects = selectedObjects !== undefined ? selectedObjects : [];
    this.visibleEdgeColor = new v3d.Color(1, 1, 1);
    this.hiddenEdgeColor = new v3d.Color(0.1, 0.04, 0.02);
    this.edgeGlow = 0.0;
    this.usePatternTexture = false;
    this.edgeThickness = 1.0;
    this.edgeStrength = 3.0;
    this.downSampleRatio = 2;
    this.pulsePeriod = 0;
    this.renderToScreen = false;

    v3d.Pass.call(this);

    this.resolution = (resolution !== undefined) ? new v3d.Vector2(resolution.x, resolution.y) : new v3d.Vector2(256, 256);

    var pars = { minFilter: v3d.LinearFilter, magFilter: v3d.LinearFilter, format: v3d.RGBAFormat };

    var resx = Math.round(this.resolution.x / this.downSampleRatio);
    var resy = Math.round(this.resolution.y / this.downSampleRatio);

    this.maskBufferMaterial = new v3d.MeshBasicMaterial({ color: 0xffffff });
    this.maskBufferMaterial.side = v3d.DoubleSide;
    this.renderTargetMaskBuffer = new v3d.WebGLRenderTarget(this.resolution.x, this.resolution.y, pars);
    this.renderTargetMaskBuffer.texture.name = "OutlinePass.mask";
    this.renderTargetMaskBuffer.texture.generateMipmaps = false;

    this.depthMaterial = new v3d.MeshDepthMaterial();
    this.depthMaterial.side = v3d.DoubleSide;
    this.depthMaterial.depthPacking = v3d.RGBADepthPacking;
    this.depthMaterial.blending = v3d.NoBlending;

    this.prepareMaskMaterial = this.getPrepareMaskMaterial();
    this.prepareMaskMaterial.side = v3d.DoubleSide;

    this.renderTargetDepthBuffer = new v3d.WebGLRenderTarget(this.resolution.x, this.resolution.y, pars);
    this.renderTargetDepthBuffer.texture.name = "OutlinePass.depth";
    this.renderTargetDepthBuffer.texture.generateMipmaps = false;

    this.renderTargetMaskDownSampleBuffer = new v3d.WebGLRenderTarget(resx, resy, pars);
    this.renderTargetMaskDownSampleBuffer.texture.name = "OutlinePass.depthDownSample";
    this.renderTargetMaskDownSampleBuffer.texture.generateMipmaps = false;

    this.renderTargetBlurBuffer1 = new v3d.WebGLRenderTarget(resx, resy, pars);
    this.renderTargetBlurBuffer1.texture.name = "OutlinePass.blur1";
    this.renderTargetBlurBuffer1.texture.generateMipmaps = false;
    this.renderTargetBlurBuffer2 = new v3d.WebGLRenderTarget(Math.round(resx / 2), Math.round(resy / 2), pars);
    this.renderTargetBlurBuffer2.texture.name = "OutlinePass.blur2";
    this.renderTargetBlurBuffer2.texture.generateMipmaps = false;

    this.edgeDetectionMaterial = this.getEdgeDetectionMaterial();
    this.renderTargetEdgeBuffer1 = new v3d.WebGLRenderTarget(resx, resy, pars);
    this.renderTargetEdgeBuffer1.texture.name = "OutlinePass.edge1";
    this.renderTargetEdgeBuffer1.texture.generateMipmaps = false;
    this.renderTargetEdgeBuffer2 = new v3d.WebGLRenderTarget(Math.round(resx / 2), Math.round(resy / 2), pars);
    this.renderTargetEdgeBuffer2.texture.name = "OutlinePass.edge2";
    this.renderTargetEdgeBuffer2.texture.generateMipmaps = false;

    var MAX_EDGE_THICKNESS = 4;
    var MAX_EDGE_GLOW = 4;

    this.separableBlurMaterial1 = this.getSeperableBlurMaterial(MAX_EDGE_THICKNESS);
    this.separableBlurMaterial1.uniforms["texSize"].value = new v3d.Vector2(resx, resy);
    this.separableBlurMaterial1.uniforms["kernelRadius"].value = 1;
    this.separableBlurMaterial2 = this.getSeperableBlurMaterial(MAX_EDGE_GLOW);
    this.separableBlurMaterial2.uniforms["texSize"].value = new v3d.Vector2(Math.round(resx / 2), Math.round(resy / 2));
    this.separableBlurMaterial2.uniforms["kernelRadius"].value = MAX_EDGE_GLOW;

    // Overlay material
    this.overlayMaterial = this.getOverlayMaterial();

    // copy material
    if (v3d.CopyShader === undefined)
        console.error("v3d.OutlinePass relies on v3d.CopyShader");

    var copyShader = v3d.CopyShader;

    this.copyUniforms = v3d.UniformsUtils.clone(copyShader.uniforms);
    this.copyUniforms["opacity"].value = 1.0;

    this.materialCopy = new v3d.ShaderMaterial({
        uniforms: this.copyUniforms,
        vertexShader: copyShader.vertexShader,
        fragmentShader: copyShader.fragmentShader,
        blending: v3d.NoBlending,
        depthTest: false,
        depthWrite: false,
        transparent: true
    });

    this.enabled = true;
    this.needsSwap = false;

    this.oldClearColor = new v3d.Color();
    this.oldClearAlpha = 1;

    this.camera = new v3d.OrthographicCamera(- 1, 1, 1, - 1, 0, 1);
    this.scene = new v3d.Scene();

    this.quad = new v3d.Mesh(new v3d.PlaneBufferGeometry(2, 2), null);
    this.quad.frustumCulled = false; // Avoid getting clipped
    this.scene.add(this.quad);

    this.tempPulseColor1 = new v3d.Color();
    this.tempPulseColor2 = new v3d.Color();
    this.textureMatrix = new v3d.Matrix4();

};

v3d.OutlinePass.prototype = Object.assign(Object.create(v3d.Pass.prototype), {

    constructor: v3d.OutlinePass,

    dispose: function() {

        this.renderTargetMaskBuffer.dispose();
        this.renderTargetDepthBuffer.dispose();
        this.renderTargetMaskDownSampleBuffer.dispose();
        this.renderTargetBlurBuffer1.dispose();
        this.renderTargetBlurBuffer2.dispose();
        this.renderTargetEdgeBuffer1.dispose();
        this.renderTargetEdgeBuffer2.dispose();

    },

    setSize: function(width, height) {

        this.renderTargetMaskBuffer.setSize(width, height);

        var resx = Math.round(width / this.downSampleRatio);
        var resy = Math.round(height / this.downSampleRatio);
        this.renderTargetMaskDownSampleBuffer.setSize(resx, resy);
        this.renderTargetBlurBuffer1.setSize(resx, resy);
        this.renderTargetEdgeBuffer1.setSize(resx, resy);
        this.separableBlurMaterial1.uniforms["texSize"].value = new v3d.Vector2(resx, resy);

        resx = Math.round(resx / 2);
        resy = Math.round(resy / 2);

        this.renderTargetBlurBuffer2.setSize(resx, resy);
        this.renderTargetEdgeBuffer2.setSize(resx, resy);

        this.separableBlurMaterial2.uniforms["texSize"].value = new v3d.Vector2(resx, resy);

    },

    changeVisibilityOfSelectedObjects: function(bVisible) {

        function gatherSelectedMeshesCallBack(object) {

            if (object instanceof v3d.Mesh) object.visible = bVisible;

        }

        for (var i = 0; i < this.selectedObjects.length; i++) {

            var selectedObject = this.selectedObjects[i];
            selectedObject.traverse(gatherSelectedMeshesCallBack);

        }

    },

    changeVisibilityOfNonSelectedObjects: function(bVisible) {

        var selectedMeshes = [];

        function gatherSelectedMeshesCallBack(object) {

            if (object instanceof v3d.Mesh) selectedMeshes.push(object);

        }

        for (var i = 0; i < this.selectedObjects.length; i++) {

            var selectedObject = this.selectedObjects[i];
            selectedObject.traverse(gatherSelectedMeshesCallBack);

        }

        function VisibilityChangeCallBack(object) {

            if (object instanceof v3d.Mesh) {

                var bFound = false;

                for (var i = 0; i < selectedMeshes.length; i++) {

                    var selectedObjectId = selectedMeshes[i].id;

                    if (selectedObjectId === object.id) {

                        bFound = true;
                        break;

                    }

                }

                if (! bFound) {

                    var visibility = object.visible;

                    if (! bVisible || object.bVisible) object.visible = bVisible;

                    object.bVisible = visibility;

                }

            }

        }

        this.renderScene.traverse(VisibilityChangeCallBack);

    },

    updateTextureMatrix: function() {

        this.textureMatrix.set(0.5, 0.0, 0.0, 0.5,
                                                        0.0, 0.5, 0.0, 0.5,
                                                        0.0, 0.0, 0.5, 0.5,
                                                        0.0, 0.0, 0.0, 1.0);
        this.textureMatrix.multiply(this.renderCamera.projectionMatrix);
        this.textureMatrix.multiply(this.renderCamera.matrixWorldInverse);

    },

    render: function(renderer, writeBuffer, readBuffer, delta, maskActive) {

        if (this.selectedObjects.length === 0) return;

        this.oldClearColor.copy(renderer.getClearColor());
        this.oldClearAlpha = renderer.getClearAlpha();
        var oldAutoClear = renderer.autoClear;

        renderer.autoClear = false;

        if (maskActive) renderer.context.disable(renderer.context.STENCIL_TEST);

        renderer.setClearColor(0xffffff, 1);

        // Make selected objects invisible
        this.changeVisibilityOfSelectedObjects(false);

        // 1. Draw Non Selected objects in the depth buffer
        this.renderScene.overrideMaterial = this.depthMaterial;
        renderer.render(this.renderScene, this.renderCamera, this.renderTargetDepthBuffer, true);

        // Make selected objects visible
        this.changeVisibilityOfSelectedObjects(true);

        // Update Texture Matrix for Depth compare
        this.updateTextureMatrix();

        // Make non selected objects invisible, and draw only the selected objects, by comparing the depth buffer of non selected objects
        this.changeVisibilityOfNonSelectedObjects(false);
        this.renderScene.overrideMaterial = this.prepareMaskMaterial;
        this.prepareMaskMaterial.uniforms["cameraNearFar"].value = new v3d.Vector2(this.renderCamera.near, this.renderCamera.far);
        this.prepareMaskMaterial.uniforms["depthTexture"].value = this.renderTargetDepthBuffer.texture;
        this.prepareMaskMaterial.uniforms["textureMatrix"].value = this.textureMatrix;
        renderer.render(this.renderScene, this.renderCamera, this.renderTargetMaskBuffer, true);
        this.renderScene.overrideMaterial = null;
        this.changeVisibilityOfNonSelectedObjects(true);

        // 2. Downsample to Half resolution
        this.quad.material = this.materialCopy;
        this.copyUniforms["tDiffuse"].value = this.renderTargetMaskBuffer.texture;
        renderer.render(this.scene, this.camera, this.renderTargetMaskDownSampleBuffer, true);

        this.tempPulseColor1.copy(this.visibleEdgeColor);
        this.tempPulseColor2.copy(this.hiddenEdgeColor);

        if (this.pulsePeriod > 0) {

            var scalar = (1 + 0.25) / 2 + Math.cos(performance.now() * 0.01 / this.pulsePeriod) * (1.0 - 0.25) / 2;
            this.tempPulseColor1.multiplyScalar(scalar);
            this.tempPulseColor2.multiplyScalar(scalar);

        }

        // 3. Apply Edge Detection Pass
        this.quad.material = this.edgeDetectionMaterial;
        this.edgeDetectionMaterial.uniforms["maskTexture"].value = this.renderTargetMaskDownSampleBuffer.texture;
        this.edgeDetectionMaterial.uniforms["texSize"].value = new v3d.Vector2(this.renderTargetMaskDownSampleBuffer.width, this.renderTargetMaskDownSampleBuffer.height);
        this.edgeDetectionMaterial.uniforms["visibleEdgeColor"].value = this.tempPulseColor1;
        this.edgeDetectionMaterial.uniforms["hiddenEdgeColor"].value = this.tempPulseColor2;
        renderer.render(this.scene, this.camera, this.renderTargetEdgeBuffer1, true);

        // 4. Apply Blur on Half res
        this.quad.material = this.separableBlurMaterial1;
        this.separableBlurMaterial1.uniforms["colorTexture"].value = this.renderTargetEdgeBuffer1.texture;
        this.separableBlurMaterial1.uniforms["direction"].value = v3d.OutlinePass.BlurDirectionX;
        this.separableBlurMaterial1.uniforms["kernelRadius"].value = this.edgeThickness;
        renderer.render(this.scene, this.camera, this.renderTargetBlurBuffer1, true);
        this.separableBlurMaterial1.uniforms["colorTexture"].value = this.renderTargetBlurBuffer1.texture;
        this.separableBlurMaterial1.uniforms["direction"].value = v3d.OutlinePass.BlurDirectionY;
        renderer.render(this.scene, this.camera, this.renderTargetEdgeBuffer1, true);

        // Apply Blur on quarter res
        this.quad.material = this.separableBlurMaterial2;
        this.separableBlurMaterial2.uniforms["colorTexture"].value = this.renderTargetEdgeBuffer1.texture;
        this.separableBlurMaterial2.uniforms["direction"].value = v3d.OutlinePass.BlurDirectionX;
        renderer.render(this.scene, this.camera, this.renderTargetBlurBuffer2, true);
        this.separableBlurMaterial2.uniforms["colorTexture"].value = this.renderTargetBlurBuffer2.texture;
        this.separableBlurMaterial2.uniforms["direction"].value = v3d.OutlinePass.BlurDirectionY;
        renderer.render(this.scene, this.camera, this.renderTargetEdgeBuffer2, true);

        // Blend it additively over the input texture
        this.quad.material = this.overlayMaterial;
        this.overlayMaterial.uniforms["maskTexture"].value = this.renderTargetMaskBuffer.texture;
        this.overlayMaterial.uniforms["edgeTexture1"].value = this.renderTargetEdgeBuffer1.texture;
        this.overlayMaterial.uniforms["edgeTexture2"].value = this.renderTargetEdgeBuffer2.texture;
        this.overlayMaterial.uniforms["patternTexture"].value = this.patternTexture;
        this.overlayMaterial.uniforms["edgeStrength"].value = this.edgeStrength;
        this.overlayMaterial.uniforms["edgeGlow"].value = this.edgeGlow;
        this.overlayMaterial.uniforms["usePatternTexture"].value = this.usePatternTexture;
        this.overlayMaterial.uniforms["visibleEdgeColor"].value = this.tempPulseColor1;
        this.overlayMaterial.uniforms["hiddenEdgeColor"].value = this.tempPulseColor2;


        if (maskActive) renderer.context.enable(renderer.context.STENCIL_TEST);

        renderer.render(this.scene, this.camera, readBuffer, false);

        renderer.setClearColor(this.oldClearColor, this.oldClearAlpha);
        renderer.autoClear = oldAutoClear;

    },

    getPrepareMaskMaterial: function() {

        return new v3d.ShaderMaterial({

            uniforms: {
                "depthTexture": { value: null },
                "cameraNearFar": { value: new v3d.Vector2(0.5, 0.5) },
                "textureMatrix": { value: new v3d.Matrix4() }
            },

            vertexShader:
                "varying vec2 vUv;\
                varying vec4 projTexCoord;\
                varying vec4 vPosition;\
                uniform mat4 textureMatrix;\
                void main() {\
                    vUv = uv;\
                    vPosition = modelViewMatrix * vec4(position, 1.0);\
                    vec4 worldPosition = modelMatrix * vec4(position, 1.0);\
                    projTexCoord = textureMatrix * worldPosition;\
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n\
                }",

            fragmentShader:
                "#include <packing>\
                varying vec2 vUv;\
                varying vec4 vPosition;\
                varying vec4 projTexCoord;\
                uniform sampler2D depthTexture;\
                uniform vec2 cameraNearFar;\
                \
                void main() {\
                    float depth = unpackRGBAToDepth(texture2DProj(depthTexture, projTexCoord));\
                    float viewZ = -perspectiveDepthToViewZ(depth, cameraNearFar.x, cameraNearFar.y);\
                    float depthTest = (-vPosition.z > viewZ) ? 1.0 : 0.0;\
                    gl_FragColor = vec4(0.0, depthTest, 1.0, 0.0);\
                }"
        });

    },

    getEdgeDetectionMaterial: function() {

        return new v3d.ShaderMaterial({

            uniforms: {
                "maskTexture": { value: null },
                "texSize": { value: new v3d.Vector2(0.5, 0.5) },
                "visibleEdgeColor": { value: new v3d.Vector3(1.0, 1.0, 1.0) },
                "hiddenEdgeColor": { value: new v3d.Vector3(1.0, 1.0, 1.0) },
            },

            vertexShader:
                "varying vec2 vUv;\n\
                void main() {\n\
                    vUv = uv;\n\
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n\
                }",

            fragmentShader:
                "varying vec2 vUv;\
                uniform sampler2D maskTexture;\
                uniform vec2 texSize;\
                uniform vec3 visibleEdgeColor;\
                uniform vec3 hiddenEdgeColor;\
                \
                void main() {\n\
                    vec2 invSize = 1.0 / texSize;\
                    vec4 uvOffset = vec4(1.0, 0.0, 0.0, 1.0) * vec4(invSize, invSize);\
                    vec4 c1 = texture2D(maskTexture, vUv + uvOffset.xy);\
                    vec4 c2 = texture2D(maskTexture, vUv - uvOffset.xy);\
                    vec4 c3 = texture2D(maskTexture, vUv + uvOffset.yw);\
                    vec4 c4 = texture2D(maskTexture, vUv - uvOffset.yw);\
                    float diff1 = (c1.r - c2.r)*0.5;\
                    float diff2 = (c3.r - c4.r)*0.5;\
                    float d = length(vec2(diff1, diff2));\
                    float a1 = min(c1.g, c2.g);\
                    float a2 = min(c3.g, c4.g);\
                    float visibilityFactor = min(a1, a2);\
                    vec3 edgeColor = 1.0 - visibilityFactor > 0.001 ? vec3(1,0,0) : vec3(0,1,0);\
                    gl_FragColor = vec4(edgeColor, 1.0) * vec4(d);\
                }"
        });

    },

    getSeperableBlurMaterial: function(maxRadius) {

        return new v3d.ShaderMaterial({

            defines: {
                "MAX_RADIUS": maxRadius,
            },

            uniforms: {
                "colorTexture": { value: null },
                "texSize": { value: new v3d.Vector2(0.5, 0.5) },
                "direction": { value: new v3d.Vector2(0.5, 0.5) },
                "kernelRadius": { value: 1.0 }
            },

            vertexShader:
                "varying vec2 vUv;\n\
                void main() {\n\
                    vUv = uv;\n\
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n\
                }",

            fragmentShader:
                "#include <common>\
                varying vec2 vUv;\
                uniform sampler2D colorTexture;\
                uniform vec2 texSize;\
                uniform vec2 direction;\
                uniform float kernelRadius;\
                \
                float gaussianPdf(in float x, in float sigma) {\
                    return 0.39894 * exp(-0.5 * x * x/(sigma * sigma))/sigma;\
                }\
                void main() {\
                    vec2 invSize = 1.0 / texSize;\
                    float weightSum = gaussianPdf(0.0, kernelRadius);\
                    vec3 diffuseSum = texture2D(colorTexture, vUv).rgb * weightSum;\
                    vec2 delta = direction * invSize * kernelRadius/float(MAX_RADIUS);\
                    vec2 uvOffset = delta;\
                    for(int i = 1; i <= MAX_RADIUS; i++) {\
                        float w = gaussianPdf(uvOffset.x, kernelRadius);\
                        vec3 sample1 = texture2D(colorTexture, vUv + uvOffset).rgb;\
                        vec3 sample2 = texture2D(colorTexture, vUv - uvOffset).rgb;\
                        diffuseSum += ((sample1 + sample2) * w);\
                        weightSum += (2.0 * w);\
                        uvOffset += delta;\
                    }\
                    gl_FragColor = vec4(diffuseSum/weightSum, 1.0);\
                }"
        });

    },

    getOverlayMaterial: function() {

        return new v3d.ShaderMaterial({

            uniforms: {
                "maskTexture": { value: null },
                "edgeTexture1": { value: null },
                "edgeTexture2": { value: null },
                "patternTexture": { value: null },
                "edgeStrength": { value: 1.0 },
                "edgeGlow": { value: 1.0 },
                "usePatternTexture": { value: 0.0 },
                "visibleEdgeColor": { value: new v3d.Vector3(1.0, 1.0, 1.0) },
                "hiddenEdgeColor": { value: new v3d.Vector3(1.0, 1.0, 1.0) },
            },

            vertexShader:
                "varying vec2 vUv;\n\
                void main() {\n\
                    vUv = uv;\n\
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n\
                }",

            fragmentShader:
                "varying vec2 vUv;\
                uniform sampler2D maskTexture;\
                uniform sampler2D edgeTexture1;\
                uniform sampler2D edgeTexture2;\
                uniform sampler2D patternTexture;\
                uniform float edgeStrength;\
                uniform float edgeGlow;\
                uniform bool usePatternTexture;\
                uniform vec3 visibleEdgeColor;\
                uniform vec3 hiddenEdgeColor;\
                \
                void main() {\
                    vec4 edgeValue1 = texture2D(edgeTexture1, vUv);\
                    vec4 edgeValue2 = texture2D(edgeTexture2, vUv);\
                    vec4 maskColor = texture2D(maskTexture, vUv);\
                    vec4 patternColor = texture2D(patternTexture, 6.0 * vUv);\
                    float visibilityFactor = 1.0 - maskColor.g > 0.0 ? 1.0 : 0.5;\
                    vec4 edgeValue = edgeStrength * (edgeValue1 + edgeValue2 * edgeGlow);\
                    edgeValue.a = max(edgeValue.r, edgeValue.g);\
                    vec3 edgeColor = edgeValue.r * visibleEdgeColor + edgeValue.g * hiddenEdgeColor;\
                    vec4 finalColor = vec4(edgeColor, edgeValue.a*1.0);\
                    if(usePatternTexture)\
                        finalColor += + visibilityFactor * (1.0 - maskColor.r) * (1.0 - patternColor.r);\
                    gl_FragColor = finalColor;\
                }",
            blending: v3d.NormalBlending,
            depthTest: false,
            depthWrite: false,
            transparent: true,
        });

    }

});

v3d.OutlinePass.BlurDirectionX = new v3d.Vector2(1.0, 0.0);
v3d.OutlinePass.BlurDirectionY = new v3d.Vector2(0.0, 1.0);