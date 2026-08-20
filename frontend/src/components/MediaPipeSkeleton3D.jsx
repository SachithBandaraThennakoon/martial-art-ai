import { Line } from "@react-three/drei";
import { memo, useMemo } from "react";
import { buildMediaPipePoseGraph } from "../skeleton/mediaPipePoseGraph";

const BONE_COLOR = "#c8d2dc";
const JOINT_COLOR = "#edf3f7";

const MediaPipeSkeleton3D = memo(function MediaPipeSkeleton3D({
  graph: suppliedGraph,
  landmarks,
  jointRadius = 0.025,
  lineWidth = 1.45,
  onSelect,
  selectedId = null,
  trajectory = [],
}) {
  const graph = useMemo(
    () => suppliedGraph || buildMediaPipePoseGraph(landmarks),
    [landmarks, suppliedGraph],
  );
  const nodes = [...graph.nodes.values()];

  return (
    <group userData={{ skeletonType: "mediapipe-pose-33" }}>
      {trajectory.length > 1 ? <Line color="#f2c35f" dashed dashScale={12} lineWidth={1.8} opacity={0.8} points={trajectory} transparent /> : null}
      {graph.edges.map(({ from, to }) => (
        <Line
          color={BONE_COLOR}
          key={`${from}-${to}`}
          lineWidth={lineWidth}
          opacity={0.86}
          points={[graph.nodes.get(from).position, graph.nodes.get(to).position]}
          transparent
        />
      ))}
      {nodes.map((node) => (
        <mesh
          key={node.id}
          onClick={onSelect ? (event) => {
            event.stopPropagation();
            onSelect(node.id, node);
          } : undefined}
          position={node.position}
          scale={selectedId === node.id ? 1.35 : 1}
          userData={{
            landmarkId: node.id,
            landmarkName: node.name,
            landmarkSource: node.source,
          }}
        >
          <sphereGeometry args={[node.virtual ? jointRadius * 0.62 : jointRadius * 0.82, 12, 10]} />
          <meshBasicMaterial color={selectedId === node.id ? "#f2c35f" : JOINT_COLOR} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
});

export default MediaPipeSkeleton3D;
