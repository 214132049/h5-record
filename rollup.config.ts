import typescript from "@rollup/plugin-typescript";
import nodeResolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import babel from "@rollup/plugin-babel";
import {terser} from "rollup-plugin-terser";
// @ts-ignore
import workerLoader from 'rollup-plugin-web-worker-loader';
import pkg from './package.json'

export default {
  input: pkg.entry,
  output: {
    name: 'H5Record',
    file: pkg.iffe,
    format: 'iife',
    sourcemap: true
  },
  plugins: [
    nodeResolve({
      extensions: ['.ts', '.js']
    }),
    commonjs(),
    workerLoader({
      targetPlatform: 'browser',
      extensions: ['.ts'],
      preserveSource: true
    }),
    typescript(),
    babel({
      babelHelpers: 'runtime',
      exclude: 'node_modules/**'
    }),
    terser()
  ]
}