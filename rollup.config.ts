import typescript from "@rollup/plugin-typescript";
import nodeResolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import {terser} from "rollup-plugin-terser";
import copy from 'rollup-plugin-copy'
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
      extensions: ['.ts']
    }),
    typescript(),
    terser({
      output: {
        comments: false,
      }
    }),
    copy({
      targets: [
        {src: 'replay/*', dest: 'build'},
        {src: 'replay/*', dest: 'dist'},
      ]
    })
  ]
}