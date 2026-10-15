import {
	ClampToEdgeWrapping,
	DoubleSide,
	LinearFilter,
	LinearMipmapLinearFilter,
	MeshBasicMaterial,
	NearestFilter,
	NoColorSpace,
	RepeatWrapping,
	SRGBColorSpace,
	Vector4,
	type Texture,
} from 'three';

interface LEDTexture {
	parameter: string;
	sRGB: boolean;
	rgbScale: number;
	addressX: string;
	addressY: string;
	mipmaps: boolean;
	nearest: boolean;
	cube: boolean;
}

export interface FurnitureLEDSignPreview {
	version: 1;
	family: 'led-sign-scroll';
	requiredUv: number[];
	scalars: Record<string, number>;
	colors: Record<string, [number, number, number, number]>;
	textures: Record<string, LEDTexture>;
}

const scalarKeys = [
	'LogoHueShift',
	'Logo Angle',
	'LogoSaturation',
	'Min_Scroll',
	'Max_Scroll',
	'Emissive Amount',
	'Opacity',
];

const colorKeys = ['Logo UV', 'Scroll Scale/Speed', 'EmissiveColor', 'Color'];
const uniformName = (key: string) => `led${key.replace(/[^a-zA-Z0-9_]/g, '_')}`;

export function readFurnitureLEDSignPreview(value: unknown): FurnitureLEDSignPreview | null {
	if (!value || typeof value !== 'object') return null;

	const p = value as FurnitureLEDSignPreview;
	if (
		p.version !== 1 ||
		p.family !== 'led-sign-scroll' ||
		!Array.isArray(p.requiredUv) ||
		p.requiredUv.length !== 1 ||
		p.requiredUv[0] !== 0 ||
		!p.scalars ||
		!p.colors ||
		!p.textures ||
		scalarKeys.some((key) => !Number.isFinite(p.scalars[key])) ||
		colorKeys.some(
			(key) =>
				!Array.isArray(p.colors[key]) ||
				p.colors[key]!.length !== 4 ||
				!p.colors[key]!.every(Number.isFinite),
		)
	) return null;
	if (
		p.colors.Color!.some((value) => value !== 0) ||
		p.scalars.Opacity! < 0 ||
		p.scalars.Opacity! > 1
	) return null;

	for (const role of ['D', 'O']) {
		const t = p.textures[role];
		if (
			!t ||
			t.parameter !== (role === 'D' ? 'Logo' : 'Scroll Texture') ||
			typeof t.sRGB !== 'boolean' ||
			t.cube ||
			!Number.isFinite(t.rgbScale) ||
			t.rgbScale !== 1 ||
			typeof t.mipmaps !== 'boolean' ||
			typeof t.nearest !== 'boolean' ||
			![t.addressX, t.addressY].every((address) => ['TA_Wrap', 'TA_Clamp'].includes(address))
		) return null;
	}

	return p;
}

const colorCore = /* glsl */ `
{
// The source vertex-interpolated effect time is frozen at zero. Logo UV BA
// and Scroll Scale/Speed BA are panners, not constant UV offsets.
float angle=ledLogo_Angle*6.28318530718;
mat2 rotation=mat2(cos(angle),sin(angle),-sin(angle),cos(angle));
vec2 logoUV=rotation*(vLEDUV*ledLogo_UV.xy-.5)+.5;
vec3 logo=texture2D(ledD,logoUV).rgb;
float luminance=dot(logo,vec3(.3,.59,.11));
// Preshader field16 is parameter9 * -1 (0309000201000080bf06).
logo-=ledLogoSaturation*(vec3(luminance)-logo);
vec3 axis=vec3(.57735026919);
float hue=ledLogoHueShift*6.28318530718;
logo=logo*cos(hue)+cross(axis,logo)*sin(hue)+axis*dot(axis,logo)*(1.0-cos(hue));
float scroll=texture2D(ledO,vLEDUV*ledScroll_Scale_Speed.xy).r;
diffuseColor.rgb=logo*mix(ledMin_Scroll,ledMax_Scroll,scroll)*ledEmissiveColor.rgb*ledEmissive_Amount;
diffuseColor.a=ledOpacity;
}
`;

export function createLEDSignPreviewMaterial(config: FurnitureLEDSignPreview, textures: Partial<Record<string, Texture | null>>): MeshBasicMaterial {
	if (!readFurnitureLEDSignPreview(config)) throw new Error('LEDSign invalid source contract');

	const sampling: Record<string, Texture> = {};
	for (const role of ['D', 'O']) {
		if (!textures[role]) throw new Error(`LEDSign missing ${role}`);

		const source = config.textures[role]!;
		const texture = textures[role]!.clone();
		texture.colorSpace = source.sRGB ? SRGBColorSpace : NoColorSpace;
		texture.wrapS = source.addressX === 'TA_Clamp' ? ClampToEdgeWrapping : RepeatWrapping;
		texture.wrapT = source.addressY === 'TA_Clamp' ? ClampToEdgeWrapping : RepeatWrapping;
		texture.generateMipmaps = source.mipmaps;
		texture.magFilter = source.nearest ? NearestFilter : LinearFilter;
		texture.minFilter = source.nearest
			? NearestFilter
			: source.mipmaps
				? LinearMipmapLinearFilter
				: LinearFilter;
		texture.needsUpdate = true;
		sampling[role] = texture;
	}

	const material = new MeshBasicMaterial({
		transparent: true,
		depthWrite: false,
		side: DoubleSide,
		forceSinglePass: true,
	});
	material.userData.ledSignPreview = config;
	material.addEventListener('dispose', () => Object.values(sampling).forEach((texture) => texture.dispose()));
	material.onBeforeRender = (_renderer, _scene, _camera, geometry) => {
		if (!geometry.getAttribute('uv')) throw new Error('LEDSign missing source UV0');
	};
	material.onBeforeCompile = (shader) => {
		let uniforms = 'varying vec2 vLEDUV;\nuniform sampler2D ledD,ledO;\n';
		for (const key of scalarKeys) {
			uniforms += `uniform float ${uniformName(key)};\n`;
			shader.uniforms[uniformName(key)] = { value: config.scalars[key] };
		}

		for (const key of colorKeys) {
			uniforms += `uniform vec4 ${uniformName(key)};\n`;
			shader.uniforms[uniformName(key)] = { value: new Vector4(...config.colors[key]!) };
		}

		shader.uniforms.ledD = { value: sampling.D };
		shader.uniforms.ledO = { value: sampling.O };
		shader.vertexShader = `varying vec2 vLEDUV;\n${shader.vertexShader}`.replace(
			'#include <begin_vertex>',
			'#include <begin_vertex>\nvLEDUV=uv;',
		);
		shader.fragmentShader = uniforms + shader.fragmentShader.replace('#include <map_fragment>', colorCore);
	};
	material.customProgramCacheKey = () => 'led-sign-scroll-static-v1';
	return material;
}
