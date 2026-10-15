import { describe, expect, it } from 'vitest';
import { Euler, Matrix4, MeshStandardMaterial, Quaternion, ShaderLib, Vector3 } from 'three';
import {
	applyHomeSurfaceFeatures,
	homeWallBasis,
} from '../../src/materials/surface/homeSurfaceFeatures.js';
import {
	applySurfaceShader,
	type FurnitureSurface,
} from '../../src/materials/surface/surfaceShader.js';

const surface: FurnitureSurface = {
	family: 'home-hbc',
	color: [1, 1, 1],
	roughness: [0, 1],
	metalness: [0, 1],
	ao: [0, 1],
	uvScale: 1,
	uvOffset: [0, 0],
	normalUvScale: 1,
	tintUvBlend: 1,
	tintMaskBias: 0,
	textureSRGB: [true, false, false, true],
	homeUv: { isWall: 1, mirror: 0, transform: [1, 1, 0, 0] },
};

describe('HomeWallUV primitive transform inputs', () => {
	it('uses native X/Z, not source UV3 or centimeter-converted geometry dimensions', () => {
		homeWallBasis(new Matrix4()).forEach((axis, i) => {
			axis.forEach((value, j) =>
				expect(value).toBeCloseTo(
					[
						[0, -1, 0],
						[0, 0, 1],
					][i]![j]!,
					12,
				),
			);
		});

		const component = new Matrix4().compose(
			new Vector3(20, 30, 40),
			new Quaternion().setFromEuler(new Euler(0.4, -0.7, 0.2)),
			new Vector3(2, 3, 4),
		);
		const frame = new Matrix4()
			.makeRotationX(Math.PI / 2)
			.multiply(new Matrix4().makeRotationY(Math.PI / 2))
			.multiply(new Matrix4().makeScale(-1, 1, 1));
		const transformed = frame.multiply(component);
		homeWallBasis(component).forEach((axis, i) => {
			const expected = new Vector3().setFromMatrixColumn(transformed, i);
			axis.forEach((value, j) => expect(value).toBeCloseTo(expected.getComponent(j), 12));
		});
	});

	it('retains component rotation/scale under nonuniform, mirrored instance transforms', () => {
		const component = new Matrix4().makeRotationZ(Math.PI / 2).scale(new Vector3(2, 3, 4));
		const instance = new Matrix4().makeRotationZ(0.6).scale(new Vector3(-5, 7, 11));
		const axes = homeWallBasis(component).map((axis) => new Vector3().fromArray(axis).applyMatrix4(instance));
		expect(axes[0]!.length()).toBeCloseTo(22);
		expect(axes[1]!.length()).toBeCloseTo(21);
	});

	it('requires the per-component basis and compiles the instance-aware scale, independently of UV3', () => {
		const material = new MeshStandardMaterial();
		applySurfaceShader(material, surface, null, null);
		expect(() => applyHomeSurfaceFeatures(material, surface, null, 0)).toThrow('component X/Z transform basis');
		material.userData.homeWallBasis = homeWallBasis(new Matrix4());
		applyHomeSurfaceFeatures(material, surface, null, 0);

		const shader = {
			vertexShader: ShaderLib.standard.vertexShader,
			fragmentShader: ShaderLib.standard.fragmentShader,
			uniforms: {},
		};

		material.onBeforeCompile(shader, {} as never);
		expect(shader.vertexShader).toContain('homeWallWorld * mat3(instanceMatrix)');
		expect(shader.vertexShader).toContain('length(homeWallWorld * homeWallBasisX)');
		expect(shader.vertexShader).not.toContain('vec2(uv3.x');
		expect(material.customProgramCacheKey()).toContain('_home_v2_');
		material.dispose();
	});
});
