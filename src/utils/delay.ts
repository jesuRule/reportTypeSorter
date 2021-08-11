const delay = async (miliseconds: number): Promise<unknown> => {
  return new Promise((resolve) => {
    setTimeout(resolve, miliseconds, null);
  });
};

export { delay };
